import { spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";
import { evaluateProjectDirectory } from "../src/check-command.js";
import { summarizeCoverage } from "../src/coverage.js";
import {
  requirementSourceFilename,
  reportProjectDirectory,
} from "../src/report.js";
import { buildQualitySite, renderOverview } from "./build-quality-site.js";
import {
  fetchJapaneseViews,
  type JapaneseArtifactAccess,
} from "./fetch-japanese-views.js";
import { GENERATED_VIEW_NOTICE } from "./generate-japanese-views.js";
import {
  collectQualityOverview,
  countMissingEvidence,
  overallStatus,
} from "./quality-overview.js";
import type { VerificationProjectCheckResult } from "../src/check.js";

const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-005/SCN-002/CASE-002", "REQ-009/SCN-001/CASE-003"],
  "integration",
);

describe("quality site assembly", () => {
  it("stages all reports and links Requirement Coverage first", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-quality-site-"));
    try {
      for (const report of ["moura-report", "allure-report", "coverage"]) {
        await mkdir(join(directory, report));
        await writeFile(join(directory, report, "index.html"), report);
      }
      const run = spawnSync(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          resolve("scripts/build-quality-site.ts"),
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, GITHUB_SHA: "0123456789abcdef" },
        },
      );
      expect(run.status, run.stderr).toBe(0);
      const landing = await readFile(
        join(directory, "_site/index.html"),
        "utf8",
      );
      expect(landing.indexOf("Requirement Coverage")).toBeLessThan(
        landing.indexOf("Missing Evidence"),
      );
      expect(landing.indexOf("Missing Evidence")).toBeLessThan(
        landing.indexOf("Test Results"),
      );
      expect(landing.indexOf("Test Results")).toBeLessThan(
        landing.indexOf("Code Coverage"),
      );
      expect(landing).toContain('href="./moura/"');
      expect(landing).toContain('href="./allure/"');
      expect(landing).toContain('href="./coverage/"');
      expect(landing).toContain(
        'href="https://github.com/specxai/moura">specxai/moura</a>',
      );
      expect(landing).toContain("Commit:</span> <code>0123456</code>");
      expect(landing).not.toContain("Japanese Documentation");
      expect(landing).not.toContain("Currently unavailable");
      expect(landing).not.toContain('href="./ja/');
      for (const report of ["moura", "allure", "coverage"])
        await expect(
          readFile(join(directory, "_site", report, "index.html"), "utf8"),
        ).resolves.toBeTruthy();
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it.each(["missing", "invalid", "stale", "partial", "notice"])(
    "preserves canonical publication when Japanese views are %s",
    async (failure) => {
      const f = await japaneseFixture();
      try {
        await fetchJapaneseViews(f.root, f.access);
        await buildQualitySite(f.root);
        const stage = join(f.root, "node_modules/.cache/moura-japanese-views");
        if (failure === "missing") await rm(stage, { recursive: true });
        if (failure === "invalid")
          await writeFile(
            join(stage, "spec.md"),
            f.pair.specifications.replace("CASE-001", "CASE-999"),
          );
        if (failure === "stale")
          await writeFile(
            join(f.root, "req.md"),
            f.inputs["req.md"] + "\nNew prose.\n",
          );
        if (failure === "partial") await rm(join(stage, "req.md"));
        if (failure === "notice")
          await writeFile(
            join(stage, "req.md"),
            f.pair.requirements.slice(GENERATED_VIEW_NOTICE.length),
          );
        await buildQualitySite(f.root);
        const landing = await readFile(
          join(f.root, "_site/index.html"),
          "utf8",
        );
        expect(landing).not.toContain("Currently unavailable");
        expect(landing).not.toContain('href="./ja/');
        await expect(readdir(join(f.root, "_site/ja"))).rejects.toThrow();
        for (const destination of ["moura", "allure", "coverage"])
          expect(
            await readFile(
              join(f.root, `_site/${destination}/index.html`),
              "utf8",
            ),
          ).toBeTruthy();
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    },
  );

  it("enriches REQ and Spec pages with validated translations while keeping mixed English sources readable", async () => {
    const f = await japaneseFixture();
    try {
      f.inputs["moura.yaml"] =
        f.inputs["moura.yaml"]
          .replace("[req.md]", "[req.md, extra.md]")
          .replace("[spec.md]", "[spec.md, extra-spec.md]") +
        "  - id: REQ-002\n    scenarios:\n      - id: SCN-001\n        cases: [{ id: CASE-001, verify: [unit] }]\n";
      await writeFile(join(f.root, "moura.yaml"), f.inputs["moura.yaml"]);
      await writeFile(join(f.root, "extra.md"), "## REQ-002 English only\n");
      await writeFile(
        join(f.root, "extra-spec.md"),
        "## REQ-002\n### SCN-001\n#### CASE-001 English only\n",
      );
      await mkdir(join(f.root, "allure-results"));
      expect((await reportProjectDirectory(f.root)).exitCode).toBe(0);
      expect((await fetchJapaneseViews(f.root, f.access)).views).toBeDefined();
      await buildQualitySite(f.root);
      const report = await readFile(
        join(f.root, "_site/moura/index.html"),
        "utf8",
      );
      const landing = await readFile(join(f.root, "_site/index.html"), "utf8");
      expect(landing).not.toContain("Japanese Documentation");
      expect(landing).not.toContain("Requirements →");
      expect(landing).not.toContain("Specifications →");
      expect(landing).not.toContain('href="./ja/');
      await expect(readdir(join(f.root, "_site/ja"))).rejects.toThrow();
      expect(report).toContain('data-language="ja"');
      expect(report).toContain('data-ja="Moura 要求カバレッジ"');
      expect(report).toContain(
        'data-map-title="REQ-001" data-map-source="req.md" data-ja="読む">Read</span>',
      );
      expect(report).toContain(
        'data-map-title="REQ-001/SCN-001/CASE-001" data-map-source="spec.md" data-ja="読む">Read</span>',
      );
      expect(report).toContain(
        'data-map-title="REQ-002" data-map-source="extra.md">English only</span>',
      );
      expect(report).toContain(
        `./sources/${requirementSourceFilename("spec.md")}#requirement-52-45-51-2d-30-30-31-2f-53-43-4e-2d-30-30-31`,
      );
      for (const source of ["req.md", "spec.md"]) {
        const page = await readFile(
          join(
            f.root,
            "_site/moura/sources",
            requirementSourceFilename(source),
          ),
          "utf8",
        );
        expect(page).toContain("<template data-translation>");
        expect(page).toContain("読む");
        expect(page).toContain('id="requirement-52-45-51-2d-30-30-31"');
        expect(page).toContain(
          `rel="canonical" href="./${requirementSourceFilename(source)}"`,
        );
        expect(page).not.toContain('<script>alert("unsafe")</script>');
      }
      for (const source of ["extra.md", "extra-spec.md"]) {
        const page = await readFile(
          join(
            f.root,
            "_site/moura/sources",
            requirementSourceFilename(source),
          ),
          "utf8",
        );
        expect(page).not.toContain("<template data-translation>");
        expect(page).toContain("English only");
        expect(page).toContain("data-fallback");
      }
      // Invalid staging must also remove a previously published translation.
      await writeFile(
        join(f.root, "node_modules/.cache/moura-japanese-views/spec.md"),
        "invalid",
      );
      await buildQualitySite(f.root);
      const fallback = await readFile(
        join(
          f.root,
          "_site/moura/sources",
          requirementSourceFilename("req.md"),
        ),
        "utf8",
      );
      expect(fallback).not.toContain("<template data-translation>");
      expect(fallback).toContain("## REQ-001 Read");
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

  it("keeps canonical parsing, IDs, evidence, coverage, locations, and source snapshots identical across Japanese states", async () => {
    const f = await japaneseFixture();
    try {
      await mkdir(join(f.root, "allure-results"));
      await writeFile(
        join(f.root, "allure-results/unit-result.json"),
        JSON.stringify({
          name: "canonical test",
          status: "passed",
          labels: [
            { name: "moura_requirement", value: "REQ-001" },
            { name: "moura_scenario", value: "SCN-001" },
            { name: "moura_case", value: "CASE-001" },
            { name: "moura_layer", value: "unit" },
          ],
        }),
      );
      const baseline = await evaluateProjectDirectory(f.root, {
        strictTraceability: true,
      });
      expect(baseline.kind).toBe("checked");
      if (baseline.kind !== "checked")
        throw new Error("Invalid canonical fixture");
      const baselineCoverage = summarizeCoverage(
        baseline.manifest,
        baseline.check,
      );
      const baselineReport = await reportProjectDirectory(f.root);
      expect(baselineReport.exitCode).toBe(0);
      const snapshot = async () => {
        const sources = await readdir(join(f.root, "moura-report/sources"));
        return Promise.all(
          ["index.html", ...sources.map((source) => `sources/${source}`)].map(
            async (path) => [
              path,
              await readFile(join(f.root, "moura-report", path), "utf8"),
            ],
          ),
        );
      };
      const baselineFiles = await snapshot();
      for (const state of ["absent", "valid", "corrupt"]) {
        if (state !== "absent") await fetchJapaneseViews(f.root, f.access);
        if (state === "corrupt")
          await writeFile(
            join(f.root, "node_modules/.cache/moura-japanese-views/spec.md"),
            "## REQ-NOT-CANONICAL\n",
          );
        // Generated docs/ja files are ignored/unconfigured even when corrupt.
        await mkdir(join(f.root, "docs/ja"), { recursive: true });
        await writeFile(
          join(f.root, "docs/ja/req.md"),
          "## REQ-NOT-CANONICAL\n",
        );
        const actual = await evaluateProjectDirectory(f.root, {
          strictTraceability: true,
        });
        expect(actual).toEqual(baseline);
        if (actual.kind === "checked")
          expect(summarizeCoverage(actual.manifest, actual.check)).toEqual(
            baselineCoverage,
          );
        expect((await reportProjectDirectory(f.root)).exitCode).toBe(0);
        expect(await snapshot()).toEqual(baselineFiles);
        await buildQualitySite(f.root);
        const siteReport = await readFile(
          join(f.root, "_site/moura/index.html"),
          "utf8",
        );
        const canonicalReport = await readFile(
          join(f.root, "moura-report/index.html"),
          "utf8",
        );
        if (state === "valid") {
          expect(siteReport).toContain('data-ja="読む"');
          // Only presentation attributes may differ from the canonical report.
          expect(
            siteReport.replace(
              /(data-map-source="[^"]*") data-ja="[^"]*"/gu,
              "$1",
            ),
          ).toBe(canonicalReport);
        } else expect(siteReport).toBe(canonicalReport);
      }
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });
});

describe("quality Overview v1", () => {
  const check = (
    ...statuses: Array<
      VerificationProjectCheckResult["entries"][number]["status"]
    >
  ): VerificationProjectCheckResult => ({
    passed: statuses.every(
      (status) => status !== "FAIL" && status !== "BROKEN",
    ),
    evidenceIssues: [],
    entries: statuses.map((status, index) => ({
      caseId: `REQ-001/SCN-001/CASE-00${index + 1}`,
      layer: "unit",
      status,
      severity:
        status === "PASS"
          ? "success"
          : status === "SKIPPED" || status === "UNIMPLEMENTED"
            ? "warning"
            : "error",
    })),
  });

  it.each([
    [["PASS"] as const, false, "PASS"],
    [["PASS"] as const, true, "INCOMPLETE"],
    [["MISSING"] as const, false, "INCOMPLETE"],
    [["SKIPPED"] as const, false, "INCOMPLETE"],
    [["UNIMPLEMENTED"] as const, false, "INCOMPLETE"],
    [["FAIL"] as const, false, "FAIL"],
    [["BROKEN"] as const, false, "FAIL"],
  ])(
    "derives %s with evaluation problems=%s as %s",
    (statuses, problems, expected) => {
      expect(overallStatus(check(...statuses), problems)).toBe(expected);
    },
  );

  it("counts required pairs without runtime Evidence", () => {
    expect(
      countMissingEvidence(
        check("PASS", "MISSING", "UNIMPLEMENTED", "SKIPPED"),
      ),
    ).toBe(2);
  });

  it("collects authoritative Moura, Allure, and code coverage summaries", async () => {
    const root = await overviewFixture();
    try {
      const overview = await collectQualityOverview(root);
      expect(overview).toEqual({
        status: "INCOMPLETE",
        requirementCoverage: { covered: 0, total: 1 },
        missingEvidence: 1,
        testResults: {
          tests: 3,
          passed: 1,
          failed: 1,
          broken: 0,
          skipped: 1,
        },
        codeCoverageLines: 94,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders localized labels and stable detail links in one Overview", () => {
    const html = renderOverview(
      {
        status: "PASS",
        requirementCoverage: { covered: 8, total: 8 },
        missingEvidence: 0,
        testResults: {
          tests: 122,
          passed: 120,
          failed: 0,
          broken: 0,
          skipped: 2,
        },
        codeCoverageLines: 94,
      },
      "abcdef0",
    );
    expect(html).toContain('data-status="PASS"');
    expect(html).toContain("8 / 8");
    expect(html).toContain("100%");
    expect(html).toContain('data-ja="総合ステータス"');
    expect(html).toContain('data-ja="合格">PASS');
    expect(html).toContain('data-ja="開く →">Open →');
    expect(html).toContain('data-ja="ソース:">Source:');
    expect(html).toContain('data-ja="コミット:">Commit:');
    expect(html).toContain('data-language="ja"');
    expect(renderOverview({ status: "INCOMPLETE" }, "abcdef0")).toContain(
      'data-ja="未完了">INCOMPLETE',
    );
    expect(renderOverview({ status: "FAIL" }, "abcdef0")).toContain(
      'data-ja="失敗">FAIL',
    );
    expect(html.match(/href="\.\/moura\/"/gu)).toHaveLength(3);
    expect(html.match(/href="\.\/allure\/"/gu)).toHaveLength(2);
    expect(html.match(/href="\.\/coverage\/"/gu)).toHaveLength(2);
    expect(html).not.toContain("Japanese Overview");
  });

  it("renders unavailable metrics instead of failing when summary data is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "moura-overview-empty-"));
    try {
      const overview = await collectQualityOverview(root);
      expect(overview).toEqual({ status: "INCOMPLETE" });
      expect(renderOverview(overview, "local")).toContain("Unavailable");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function overviewFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "moura-overview-"));
  await writeFile(join(root, "req.md"), "## REQ-001 Overview\n");
  await writeFile(
    join(root, "spec.md"),
    "## REQ-001\n### SCN-001\n#### CASE-001 Covered\n#### CASE-002 Missing\n",
  );
  await writeFile(
    join(root, "moura.yaml"),
    "version: 1\nsources: { requirements: [req.md], specifications: [spec.md] }\nverification: { layers: [unit] }\nrequirements:\n  - id: REQ-001\n    scenarios:\n      - id: SCN-001\n        cases:\n          - { id: CASE-001, verify: [unit] }\n          - { id: CASE-002, verify: [unit] }\n",
  );
  await mkdir(join(root, "allure-results"));
  for (const [name, status, traced] of [
    ["passing", "passed", true],
    ["failing", "failed", false],
    ["skipped", "skipped", false],
  ] as const)
    await writeFile(
      join(root, "allure-results", `${name}-result.json`),
      JSON.stringify({
        name,
        status,
        labels: traced
          ? [
              { name: "moura_requirement", value: "REQ-001" },
              { name: "moura_scenario", value: "SCN-001" },
              { name: "moura_case", value: "CASE-001" },
              { name: "moura_layer", value: "unit" },
            ]
          : [],
      }),
    );
  await mkdir(join(root, "coverage"));
  await writeFile(
    join(root, "coverage/coverage-summary.json"),
    JSON.stringify({
      total: Object.fromEntries(
        ["statements", "branches", "functions", "lines"].map((name) => [
          name,
          { pct: name === "lines" ? 94 : 90 },
        ]),
      ),
    }),
  );
  return root;
}

async function japaneseFixture() {
  const root = await mkdtemp(join(tmpdir(), "moura-quality-ja-"));
  const prose = 'Read `file.txt`. <script>alert("unsafe")</script>\n';
  const inputs = {
    "req.md": `# Requirements\n\n## REQ-001 Read\n\n${prose}`,
    "spec.md": `# Specifications\n\n## REQ-001 Read\n\n### SCN-001 Input\n\n#### CASE-001 Read\n\n${prose}`,
    "moura.yaml":
      "version: 1\nsources: { requirements: [req.md], specifications: [spec.md] }\nverification: { layers: [unit] }\nrequirements:\n  - id: REQ-001\n    scenarios:\n      - id: SCN-001\n        cases: [{ id: CASE-001, verify: [unit] }]\n",
  };
  await Promise.all(
    Object.entries(inputs).map(([path, contents]) =>
      writeFile(join(root, path), contents),
    ),
  );
  for (const report of ["moura-report", "allure-report", "coverage"]) {
    await mkdir(join(root, report));
    await writeFile(join(root, report, "index.html"), report);
  }
  const sourceSha = "a".repeat(40);
  const pair = {
    requirements:
      GENERATED_VIEW_NOTICE + inputs["req.md"].replaceAll("Read", "読む"),
    specifications:
      GENERATED_VIEW_NOTICE + inputs["spec.md"].replaceAll("Read", "読む"),
  };
  const access: JapaneseArtifactAccess = {
    json: async (path) => {
      if (path === "actions/workflows/japanese-views.yml")
        return { id: 7, path: ".github/workflows/japanese-views.yml" };
      if (path.startsWith("actions/workflows/7/runs?"))
        return {
          workflow_runs: [
            {
              id: 10,
              workflow_id: 7,
              path: ".github/workflows/japanese-views.yml",
              head_branch: "main",
              head_sha: sourceSha,
              event: "workflow_dispatch",
              status: "completed",
              conclusion: "success",
              created_at: "2026-10-01T00:00:00Z",
              run_started_at: "2026-10-01T00:00:00Z",
              run_attempt: 1,
              repository: { full_name: "specxai/moura" },
              head_repository: { full_name: "specxai/moura" },
            },
          ],
        };
      if (path.startsWith("actions/runs/10/artifacts"))
        return {
          artifacts: [
            {
              id: 1000,
              name: "moura-japanese-views",
              expired: false,
              size_in_bytes: 1000,
              created_at: "2026-10-01T00:00:00Z",
              expires_at: "2099-01-01T00:00:00Z",
              digest: `sha256:${"0".repeat(64)}`,
              workflow_run: {
                id: 10,
                head_sha: sourceSha,
                head_branch: "main",
              },
            },
          ],
        };
      const source = /^contents\/(req.md|spec.md|moura.yaml)\?ref=/u.exec(
        path,
      )?.[1] as keyof typeof inputs;
      return {
        type: "file",
        encoding: "base64",
        content: Buffer.from(inputs[source]).toString("base64"),
      };
    },
    download: async () => pair,
  };
  return { root, inputs, pair, sourceSha, access };
}
