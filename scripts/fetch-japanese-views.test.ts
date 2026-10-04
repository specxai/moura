import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it as vitestIt, vi } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";
import { GENERATED_VIEW_NOTICE } from "./generate-japanese-views.js";
import {
  fetchJapaneseViews,
  githubArtifactAccess,
  readJapaneseArchive,
  readJapaneseViews,
  selectJapaneseViews,
  type JapaneseArtifactAccess,
} from "./fetch-japanese-views.js";

const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-005/SCN-002/CASE-002"],
  "integration",
);
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const canonical = {
  "req.md": "# Requirements\n\n## REQ-001 Read files\n\nRead `file.txt`.\n",
  "spec.md":
    "# Specifications\n\n## REQ-001 Read files\n\n### SCN-001 Input\n\n#### CASE-001 Read\n\nRead `file.txt`.\n",
  "moura.yaml":
    "version: 1\nsources: { requirements: [req.md], specifications: [spec.md] }\nverification: { layers: [unit] }\nrequirements:\n  - id: REQ-001\n    scenarios:\n      - id: SCN-001\n        cases: [{ id: CASE-001, verify: [unit] }]\n",
};
const pair = {
  requirements:
    GENERATED_VIEW_NOTICE +
    canonical["req.md"]
      .replaceAll("Read files", "ファイルを読む")
      .replaceAll("Read ", "読む "),
  specifications:
    GENERATED_VIEW_NOTICE +
    canonical["spec.md"]
      .replaceAll("Read files", "ファイルを読む")
      .replaceAll("Read ", "読む "),
};
const sourceSha = "a".repeat(40);
function run(id = 10) {
  return {
    id,
    workflow_id: 7,
    path: ".github/workflows/japanese-views.yml",
    head_branch: "main",
    head_sha: sourceSha,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    created_at: `2026-10-${String(id).padStart(2, "0")}T00:00:00Z`,
    repository: { full_name: "specxai/moura" },
    head_repository: { full_name: "specxai/moura" },
  };
}
function artifact(id = 10) {
  return {
    id: id * 100,
    name: "moura-japanese-views",
    expired: false,
    size_in_bytes: 1000,
    created_at: `2026-10-${String(id).padStart(2, "0")}T00:00:00Z`,
    expires_at: "2099-01-01T00:00:00Z",
    digest: `sha256:${"0".repeat(64)}`,
    workflow_run: { id, head_sha: sourceSha, head_branch: "main" },
  };
}

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "moura-fetch-ja-"));
  roots.push(root);
  await Promise.all(
    Object.entries(canonical).map(([path, text]) =>
      writeFile(resolve(root, path), text),
    ),
  );
  const runs = [run()];
  const artifacts = new Map([[10, [artifact()]]]);
  const sources = { ...canonical };
  const json = vi.fn(async (path: string): Promise<unknown> => {
    if (path === "actions/workflows/japanese-views.yml")
      return { id: 7, path: ".github/workflows/japanese-views.yml" };
    if (path.startsWith("actions/workflows/7/runs?"))
      return { workflow_runs: runs };
    const runId = /^actions\/runs\/(\d+)\/artifacts/u.exec(path)?.[1];
    if (runId) return { artifacts: artifacts.get(Number(runId)) ?? [] };
    const source =
      /^contents\/(req.md|spec.md|moura.yaml)\?ref=([a-f0-9]{40})$/u.exec(
        path,
      )?.[1] as keyof typeof canonical | undefined;
    if (source)
      return {
        type: "file",
        encoding: "base64",
        content: Buffer.from(sources[source]).toString("base64"),
      };
    throw new Error(`Unexpected API path: ${path}`);
  });
  const download = vi.fn(async () => ({ ...pair }));
  const access: JapaneseArtifactAccess = { json, download };
  return { root, runs, artifacts, sources, json, download, access };
}

describe("optional Japanese artifact retrieval", () => {
  it("compares exact source bytes, validates, stages the pair, and records actual provenance", async () => {
    const f = await fixture();
    const result = await fetchJapaneseViews(f.root, f.access);
    expect(result.views).toMatchObject({
      ...pair,
      sourceSha,
      runId: 10,
      artifactId: 1000,
    });
    expect(
      f.json.mock.calls.filter(([path]) => path.startsWith("contents/")),
    ).toHaveLength(3);
    expect(f.download).toHaveBeenCalledWith(artifact());
    expect((await readJapaneseViews(f.root)).views).toEqual(result.views);
    const staged = await readFile(
      resolve(
        f.root,
        "node_modules/.cache/moura-japanese-views/provenance.json",
      ),
      "utf8",
    );
    expect(JSON.parse(staged).sourceDigests["spec.md"]).toBe(
      createHash("sha256").update(canonical["spec.md"]).digest("hex"),
    );
  });

  it("selects newest eligible success despite later failed, stale, or invalid attempts", async () => {
    const f = await fixture();
    f.runs.splice(
      0,
      1,
      run(8),
      { ...run(12), conclusion: "failure" },
      run(11),
      run(10),
      run(9),
    );
    for (const id of [8, 9, 11]) f.artifacts.set(id, [artifact(id)]);
    f.download.mockImplementation(async (...args: unknown[]) => {
      const selected = args[0] as { id: number };
      return selected.id === 1100
        ? {
            ...pair,
            specifications: pair.specifications.replace("CASE-001", "CASE-999"),
          }
        : { ...pair };
    });
    const result = await selectJapaneseViews(f.root, f.access);
    expect(result.views?.runId).toBe(10);
    expect(result.messages).toContain("Latest producer attempt 12: failure");
    expect(result.messages.join(" ")).toContain("consumer validation failed");
    expect(f.download).toHaveBeenCalledTimes(2);
  });

  it("selects a newer artifact produced by a rerun of an older successful run", async () => {
    const f = await fixture();
    f.runs.push(run(9));
    f.artifacts.set(9, [
      { ...artifact(9), created_at: "2026-10-12T00:00:00Z" },
    ]);
    expect((await selectJapaneseViews(f.root, f.access)).views?.runId).toBe(9);
  });

  it("falls back from source-stale newer success to matching older success", async () => {
    const f = await fixture();
    const staleSha = "b".repeat(40);
    f.runs.unshift({ ...run(11), head_sha: staleSha });
    f.artifacts.set(11, [
      {
        ...artifact(11),
        workflow_run: { ...artifact(11).workflow_run, head_sha: staleSha },
      },
    ]);
    const base = f.access.json;
    f.access.json = async (path) =>
      path.includes(staleSha)
        ? {
            type: "file",
            encoding: "base64",
            content: Buffer.from("stale prose").toString("base64"),
          }
        : base(path);
    expect((await selectJapaneseViews(f.root, f.access)).views?.runId).toBe(10);
    expect(f.download).toHaveBeenCalledTimes(1);
  });

  it.each([
    { repository: { full_name: "other/moura" } },
    { head_repository: { full_name: "fork/moura" } },
    { path: ".github/workflows/other.yml" },
    { workflow_id: 99 },
    { head_branch: "feature" },
    { event: "pull_request" },
    { status: "in_progress" },
    { conclusion: "failure" },
    { head_sha: "main" },
  ])("rejects wrong producer provenance: %j", async (change) => {
    const f = await fixture();
    Object.assign(f.runs[0]!, change);
    expect((await selectJapaneseViews(f.root, f.access)).views).toBeUndefined();
    expect(f.download).not.toHaveBeenCalled();
  });

  it.each([
    { name: "moura-japanese-views-failed-validation" },
    { expired: true },
    { expires_at: "2000-01-01T00:00:00Z" },
    { digest: "" },
    { workflow_run: { id: 99, head_sha: sourceSha, head_branch: "main" } },
    { workflow_run: { id: 10, head_sha: "b".repeat(40), head_branch: "main" } },
    { workflow_run: { id: 10, head_sha: sourceSha, head_branch: "feature" } },
    { size_in_bytes: 6 * 1024 * 1024 },
  ])("rejects debugging/expired/untrusted artifact: %j", async (change) => {
    const f = await fixture();
    Object.assign(f.artifacts.get(10)![0]!, change);
    expect((await selectJapaneseViews(f.root, f.access)).views).toBeUndefined();
    expect(f.download).not.toHaveBeenCalled();
  });

  it.each(["req.md", "spec.md", "moura.yaml"] as const)(
    "rejects stale canonical %s, including prose-only changes",
    async (path) => {
      const f = await fixture();
      await writeFile(
        resolve(f.root, path),
        canonical[path] + "\nNew canonical prose.\n",
      );
      const result = await selectJapaneseViews(f.root, f.access);
      expect(result.views).toBeUndefined();
      expect(result.messages.join(" ")).toContain(
        `${path}: producer canonical bytes differ`,
      );
      expect(f.download).not.toHaveBeenCalled();
    },
  );

  it.each([
    { requirements: "", specifications: pair.specifications },
    { requirements: pair.requirements, specifications: "" },
    { ...pair, requirements: canonical["req.md"] },
    {
      ...pair,
      specifications: pair.specifications.replace("file.txt", "changed.txt"),
    },
  ])(
    "requires a complete noticed pair and runs the existing validator: %j",
    async (documents) => {
      const f = await fixture();
      f.download.mockResolvedValue(documents);
      const result = await fetchJapaneseViews(f.root, f.access);
      expect(result.views).toBeUndefined();
      expect(f.download).toHaveBeenCalledOnce();
      expect((await readJapaneseViews(f.root)).views).toBeUndefined();
    },
  );

  it("handles missing runs/artifacts and API/download errors without retaining stale staging", async () => {
    const f = await fixture();
    await fetchJapaneseViews(f.root, f.access);
    f.artifacts.clear();
    expect((await fetchJapaneseViews(f.root, f.access)).views).toBeUndefined();
    expect((await readJapaneseViews(f.root)).views).toBeUndefined();
    f.runs.length = 0;
    expect((await selectJapaneseViews(f.root, f.access)).views).toBeUndefined();
    f.json.mockRejectedValue(new Error("HTTP 403"));
    expect(
      (await fetchJapaneseViews(f.root, f.access)).messages.join(" "),
    ).toContain("HTTP 403");
    const g = await fixture();
    g.download.mockRejectedValue(new Error("HTTP 410"));
    expect(
      (await fetchJapaneseViews(g.root, g.access)).messages.join(" "),
    ).toContain("HTTP 410");
  });

  it("does not trust changed staging, source inputs, or malformed provenance", async () => {
    const f = await fixture();
    await fetchJapaneseViews(f.root, f.access);
    const stage = resolve(f.root, "node_modules/.cache/moura-japanese-views");
    await writeFile(
      resolve(stage, "spec.md"),
      pair.specifications.replace("CASE-001", "CASE-999"),
    );
    expect((await readJapaneseViews(f.root)).messages.join(" ")).toContain(
      "consumer validation failed",
    );
    await fetchJapaneseViews(f.root, f.access);
    await writeFile(
      resolve(f.root, "req.md"),
      canonical["req.md"] + "\nChanged.\n",
    );
    expect((await readJapaneseViews(f.root)).messages.join(" ")).toContain(
      "canonical digest differs",
    );
    await writeFile(
      resolve(stage, "provenance.json"),
      '{"sourceSha":"<script>"}',
    );
    expect((await readJapaneseViews(f.root)).views).toBeUndefined();
  });

  it("bounds run lookup to three pages and orders returned runs deterministically", async () => {
    const f = await fixture();
    f.runs.splice(
      0,
      1,
      ...Array.from({ length: 100 }, () => ({
        ...run(),
        conclusion: "failure",
      })),
    );
    expect((await selectJapaneseViews(f.root, f.access)).views).toBeUndefined();
    expect(
      f.json.mock.calls.filter(([path]) =>
        path.startsWith("actions/workflows/7/runs"),
      ),
    ).toHaveLength(3);
  });

  it("handles a staging write failure without publishing a partial pair", async () => {
    const f = await fixture();
    await mkdir(resolve(f.root, "node_modules"));
    await writeFile(resolve(f.root, "node_modules/.cache"), "not a directory");
    await expect(fetchJapaneseViews(f.root, f.access)).rejects.toThrow();
  });
});

describe("GitHub artifact transport", () => {
  it("keeps the GitHub token on API requests and rejects changed archive bytes", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: {
            location: "https://storage.example/artifact?signature=secret",
          },
        }),
      )
      .mockResolvedValueOnce(new Response("changed archive"));
    const access = githubArtifactAccess(
      "token-for-test",
      AbortSignal.timeout(1000),
      request,
    );
    await expect(access.download(artifact())).rejects.toThrow(
      "digest mismatch",
    );
    expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({
      authorization: "Bearer token-for-test",
    });
    expect(request.mock.calls[1]?.[1]?.headers).toBeUndefined();
    expect(request.mock.calls[1]?.[1]?.redirect).toBe("error");
  });

  it.each(["http://storage.example/a", "file:///tmp/a"])(
    "rejects unsafe archive redirect %s",
    async (location) => {
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(null, { status: 302, headers: { location } }),
        );
      await expect(
        githubArtifactAccess(
          "test",
          AbortSignal.timeout(1000),
          request,
        ).download(artifact()),
      ).rejects.toThrow("Unsafe");
      expect(request).toHaveBeenCalledOnce();
    },
  );

  it("surfaces HTTP failures and caps response sizes without exposing response bodies", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("secret body", { status: 403 }))
      .mockResolvedValueOnce(new Response(new Uint8Array(6 * 1024 * 1024)));
    const access = githubArtifactAccess(
      "test",
      AbortSignal.timeout(1000),
      request,
    );
    await expect(
      access.json("actions/workflows/japanese-views.yml"),
    ).rejects.toThrow("HTTP 403");
    await expect(
      access.json("actions/workflows/japanese-views.yml"),
    ).rejects.toThrow("5 MiB");
  });

  it.skipIf(process.platform === "win32")(
    "reads only the complete literal pair, verifies archive digest, and never extracts other paths",
    async () => {
      // Deflated ZIP with req.md, spec.md, and ../untrusted.txt.
      const bytes = Buffer.from(
        "UEsDBBQAAAAIAB0qRF1Seo9oDgAAAAwAAAAGAAAAcmVxLm1kC0otLM0sSs1NzSspBgBQSwMEFAAAAAgAHSpEXZPyvsYQAAAADgAAAAcAAABzcGVjLm1kCy5ITc5My0xOLMnMzysGAFBLAwQUAAAACAAdKkRdi2Gb3xIAAAAQAAAAEAAAAC4uL3VudHJ1c3RlZC50eHTzSy1LLVJIrSgpSkwuUchNBQBQSwECFAMUAAAACAAdKkRdUnqPaA4AAAAMAAAABgAAAAAAAAAAAAAAgAEAAAAAcmVxLm1kUEsBAhQDFAAAAAgAHSpEXZPyvsYQAAAADgAAAAcAAAAAAAAAAAAAAIABMgAAAHNwZWMubWRQSwECFAMUAAAACAAdKkRdi2Gb3xIAAAAQAAAAEAAAAAAAAAAAAAAAgAFnAAAALi4vdW50cnVzdGVkLnR4dFBLBQYAAAAAAwADAKcAAACnAAAAAAA=",
        "base64",
      );
      expect(await readJapaneseArchive(bytes)).toEqual({
        requirements: "Requirements",
        specifications: "Specifications",
      });
      const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 302,
            headers: { location: "https://storage.example/artifact" },
          }),
        )
        .mockResolvedValueOnce(new Response(bytes));
      const selected = {
        ...artifact(),
        digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      };
      expect(
        await githubArtifactAccess(
          "test",
          AbortSignal.timeout(1000),
          request,
        ).download(selected),
      ).toEqual({
        requirements: "Requirements",
        specifications: "Specifications",
      });
      const incomplete = Buffer.from(bytes);
      for (let offset = 0; offset < incomplete.length - 6; offset++) {
        if (incomplete.subarray(offset, offset + 6).toString() === "req.md")
          incomplete.write("old.md", offset);
      }
      await expect(readJapaneseArchive(incomplete)).rejects.toThrow(
        "exactly one req.md",
      );
    },
  );

  // Production archive reading is Ubuntu-only. Selection/validation tests run on
  // Windows too; the Windows smoke never needs external artifact extraction.
  it.skipIf(process.platform === "win32")(
    "rejects malformed or incomplete ZIP data",
    async () => {
      await expect(
        readJapaneseArchive(Buffer.from("not a zip")),
      ).rejects.toThrow("ZIP");
    },
  );
});
