import {
  cp,
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it as vitestIt } from "vitest";
import { reportProjectDirectory, requirementSourceFilename } from "./report.js";
import { collectQualityOverview } from "./quality-overview.js";
import { mouraEvidenceTest } from "./test-support/moura-evidence.js";

const integration = (caseId: string) =>
  mouraEvidenceTest(vitestIt, [`REQ-010/SCN-001/${caseId}`], "integration");
const it = integration("CASE-001");
const safetyIt = integration("CASE-002");
const japaneseIt = integration("CASE-003");
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "moura-report-v2-"));
  roots.push(root);
  const project = join(root, "project");
  await cp(resolve("examples/vitest-minimal"), project, { recursive: true });
  return { root, project };
}

async function evidence(project: string, status: string) {
  await mkdir(join(project, "allure-results"), { recursive: true });
  await writeFile(
    join(project, "allure-results/test-result.json"),
    JSON.stringify({
      status,
      labels: [
        { name: "moura_requirement", value: "REQ-001" },
        { name: "moura_scenario", value: "SCN-001" },
        { name: "moura_case", value: "CASE-001" },
        { name: "moura_layer", value: "unit" },
      ],
    }),
  );
}

describe("Report CLI v2 project boundary", () => {
  it.each(["default", "relative", "absolute"])(
    "generates portable Overview, Map, and source links using %s output",
    async (mode) => {
      const { root, project } = await fixture();
      await evidence(project, "passed");
      const output =
        mode === "relative" ? "artifacts/quality" : join(root, "external");
      const result = await reportProjectDirectory(
        project,
        mode === "default" ? {} : { output },
      );
      expect(result.exitCode, result.errors.join("\n")).toBe(0);
      const expected =
        mode === "default"
          ? join(project, "moura-report")
          : resolve(project, output);
      expect(await realpath(result.overviewPath!)).toBe(
        await realpath(join(expected, "index.html")),
      );
      expect(await realpath(result.outputPath!)).toBe(
        await realpath(join(expected, "moura/index.html")),
      );
      const overview = await readFile(result.overviewPath!, "utf8");
      expect(overview).toContain('data-status="PASS"');
      expect(overview).toContain('href="./moura/index.html"');
      expect(overview).toContain('data-language="ja"');
      expect(overview).toContain('data-language="en"');
      expect(overview).not.toContain('href="./allure/"');
      expect(overview).not.toContain('href="./coverage/"');
      expect(overview).not.toContain("specxai/moura");
      const map = await readFile(result.outputPath!, "utf8");
      expect(map).toContain('href="../index.html"');
      for (const [, href] of map.matchAll(
        /href="(\.\/sources\/[^"#]+)(?:#[^"]*)?"/gu,
      ))
        expect(
          await readFile(resolve(dirname(result.outputPath!), href!), "utf8"),
        ).toContain("data-source-content");
      expect(
        (
          await reportProjectDirectory(
            project,
            mode === "default" ? {} : { output },
          )
        ).exitCode,
      ).toBe(0);
      expect(
        (await readdir(dirname(expected))).filter((name) =>
          name.startsWith(".moura-"),
        ),
      ).toEqual([]);
    },
  );

  it.each([
    ["passed", "PASS"],
    ["failed", "FAIL"],
    ["broken", "FAIL"],
    ["skipped", "INCOMPLETE"],
  ])(
    "shares authoritative %s → %s status with the Quality Site",
    async (status, expected) => {
      const { project } = await fixture();
      await evidence(project, status!);
      const result = await reportProjectDirectory(project);
      const overview = await collectQualityOverview(project);
      expect(overview.status).toBe(expected);
      expect(await readFile(result.overviewPath!, "utf8")).toContain(
        `data-status="${overview.status}"`,
      );
    },
  );

  it("generates with missing Allure and coverage data and displays missing Evidence", async () => {
    const { project } = await fixture();
    const result = await reportProjectDirectory(project);
    expect(result.overviewPath).toBeDefined();
    const overview = await collectQualityOverview(project);
    expect(overview.status).toBe("INCOMPLETE");
    expect(overview.missingEvidence).toBe(1);
    expect(overview.testResults).toBeUndefined();
    expect(overview.codeCoverageLines).toBeUndefined();
    expect(await readFile(result.overviewPath!, "utf8")).toContain(
      "Missing Evidence",
    );
    expect(await readFile(result.outputPath!, "utf8")).toContain("MISSING");
  });

  it("reads optional external coverage summary without creating or linking external HTML reports", async () => {
    const { project } = await fixture();
    await evidence(project, "passed");
    await mkdir(join(project, "coverage"));
    await writeFile(
      join(project, "coverage/coverage-summary.json"),
      JSON.stringify({
        total: Object.fromEntries(
          ["statements", "branches", "functions", "lines"].map((name) => [
            name,
            { pct: 87.5 },
          ]),
        ),
      }),
    );
    const result = await reportProjectDirectory(project);
    const html = await readFile(result.overviewPath!, "utf8");
    expect(html).toContain("87.5%");
    expect(html).not.toContain('href="./coverage/"');
    expect((await collectQualityOverview(project)).testResults?.passed).toBe(1);
  });
});

describe("output safety", () => {
  safetyIt.each([
    ".",
    "..",
    "/",
    "src",
    "test",
    "allure-results",
    "coverage",
    "requirements.md",
    "moura.yaml",
    "",
  ])("refuses dangerous output %s before changing inputs", async (output) => {
    const { project } = await fixture();
    const canonical = await readFile(join(project, "requirements.md"), "utf8");
    const result = await reportProjectDirectory(project, { output });
    expect(result.exitCode).toBe(1);
    expect(result.outputPath).toBeUndefined();
    expect(await readFile(join(project, "requirements.md"), "utf8")).toBe(
      canonical,
    );
    expect(
      (await readdir(project)).some((name) => name.startsWith(".moura-")),
    ).toBe(false);
  });

  safetyIt(
    "rejects unowned legacy output, modified generated files, and unknown added files",
    async () => {
      const { project } = await fixture();
      await evidence(project, "passed");
      const old = join(project, "legacy");
      await mkdir(old);
      await writeFile(join(old, "index.html"), "old report sentinel");
      expect(
        (await reportProjectDirectory(project, { output: old })).exitCode,
      ).toBe(1);
      expect(await readFile(join(old, "index.html"), "utf8")).toBe(
        "old report sentinel",
      );
      const result = await reportProjectDirectory(project);
      await writeFile(result.overviewPath!, "edited sentinel");
      expect((await reportProjectDirectory(project)).exitCode).toBe(1);
      expect(await readFile(result.overviewPath!, "utf8")).toBe(
        "edited sentinel",
      );
      await writeFile(
        join(project, "moura-report/input.json"),
        "input sentinel",
      );
      expect((await reportProjectDirectory(project)).exitCode).toBe(1);
      expect(
        await readFile(join(project, "moura-report/input.json"), "utf8"),
      ).toBe("input sentinel");
    },
  );

  safetyIt.each(["directory", "parent", "dangling", "entry", "hardlink"])(
    "rejects %s links without changing their targets",
    async (mode) => {
      const { root, project } = await fixture();
      await evidence(project, "passed");
      const outside = join(root, "outside");
      await mkdir(outside);
      const sentinel = join(outside, "sentinel.html");
      await writeFile(sentinel, "sentinel");
      let output = join(project, "moura-report");
      if (mode === "directory" || mode === "parent") {
        await symlink(outside, output, "junction");
        if (mode === "parent") output = join(output, "nested");
      } else if (mode === "dangling")
        await symlink(join(root, "missing"), output, "junction");
      else {
        expect((await reportProjectDirectory(project)).exitCode).toBe(0);
        await rm(join(output, "index.html"));
        if (mode === "hardlink")
          await link(sentinel, join(output, "index.html"));
        else await symlink(sentinel, join(output, "index.html"));
      }
      expect((await reportProjectDirectory(project, { output })).exitCode).toBe(
        1,
      );
      expect(await readFile(sentinel, "utf8")).toBe("sentinel");
      expect(await readdir(outside)).toEqual(["sentinel.html"]);
    },
  );

  safetyIt(
    "protects input data reached through a canonical-source symlink",
    async () => {
      const { root, project } = await fixture();
      const input = join(root, "input");
      await mkdir(input);
      const markdown = await readFile(join(project, "requirements.md"), "utf8");
      await writeFile(join(input, "req.md"), markdown);
      await rm(join(project, "requirements.md"));
      await symlink(join(input, "req.md"), join(project, "requirements.md"));
      expect(
        (await reportProjectDirectory(project, { output: input })).exitCode,
      ).toBe(1);
      expect(await readFile(join(input, "req.md"), "utf8")).toBe(markdown);
    },
  );
});

describe("report output ownership and permissions", () => {
  safetyIt.each(["empty", "nonempty", "invalid-marker"])(
    "preserves existing unowned %s output unchanged",
    async (kind) => {
      const { project } = await fixture();
      const output = join(project, "custom-report");
      await mkdir(output);
      if (kind !== "empty")
        await writeFile(
          join(output, kind === "nonempty" ? "sentinel" : ".moura-report.json"),
          "sentinel",
        );
      const before = await lstat(output);
      const entries = await readdir(output);
      const result = await reportProjectDirectory(project, { output });
      expect(result.exitCode).toBe(1);
      expect(await readdir(output)).toEqual(entries);
      expect((await lstat(output)).ino).toBe(before.ino);
      expect((await lstat(output)).mode).toBe(before.mode);
      for (const entry of entries)
        expect(await readFile(join(output, entry), "utf8")).toBe("sentinel");
    },
  );
  safetyIt.skipIf(process.platform === "win32")(
    "publishes umask permissions and preserves owned directory and HTML modes on update",
    async () => {
      const { project } = await fixture();
      const result = await reportProjectDirectory(project);
      const output = dirname(result.overviewPath!);
      expect((await lstat(output)).mode & 0o777).toBe(0o777 & ~process.umask());
      expect((await lstat(result.overviewPath!)).mode & 0o777).toBe(
        0o666 & ~process.umask(),
      );
      const directories = [
        output,
        join(output, "moura"),
        join(output, "moura/sources"),
      ];
      for (const directory of directories) await chmod(directory, 0o750);
      const source = join(
        output,
        "moura/sources",
        requirementSourceFilename("requirements.md"),
      );
      for (const file of [result.overviewPath!, result.outputPath!, source])
        await chmod(file, 0o640);
      const updated = await reportProjectDirectory(project);
      expect(updated.overviewPath, updated.errors.join("\n")).toBeDefined();
      for (const directory of directories)
        expect((await lstat(directory)).mode & 0o777).toBe(0o750);
      for (const file of [updated.overviewPath!, updated.outputPath!, source]) {
        expect((await lstat(file)).mode & 0o777).toBe(0o640);
        expect(await readFile(file, "utf8")).toContain("<!doctype html>");
      }
    },
  );
});

describe("validated Japanese views", () => {
  japaneseIt.each(["valid", "REQ", "SCN", "CASE"])(
    "validates every role of shared Markdown: %s",
    async (change) => {
      const { project } = await fixture();
      const canonical = await readFile(
        join(project, "specification.md"),
        "utf8",
      );
      await writeFile(join(project, "shared.md"), canonical);
      const manifest = await readFile(join(project, "moura.yaml"), "utf8");
      await writeFile(
        join(project, "moura.yaml"),
        manifest
          .replace("requirements.md", "shared.md")
          .replace("specification.md", "shared.md"),
      );
      let translated = canonical
        .replace("Add two finite numbers", "二つの有限数を加算")
        .replace("Add two positive integers", "二つの正整数を加算");
      if (change !== "valid")
        translated = translated.replace(`${change}-001`, `${change}-999`);
      await writeFile(join(project, "shared-ja.md"), translated);
      await writeFile(
        join(project, "views.json"),
        JSON.stringify({ "shared.md": "shared-ja.md" }),
      );
      const result = await reportProjectDirectory(project, {
        japaneseViews: "views.json",
      });
      if (change !== "valid") {
        expect(result.errors.join("\n")).toContain("Invalid Japanese view");
        expect(await readdir(project)).not.toContain("moura-report");
      } else {
        expect(result.overviewPath, result.errors.join("\n")).toBeDefined();
        const html = await readFile(
          join(
            dirname(result.outputPath!),
            "sources",
            requirementSourceFilename("shared.md"),
          ),
          "utf8",
        );
        const japanese = html.split("<template data-translation")[1]!;
        expect(japanese).toBeDefined();
        const map = await readFile(result.outputPath!, "utf8");
        const anchors = new Set(
          [...map.matchAll(/href="\.\/sources\/[^"#]+#([^"]+)"/gu)].map(
            (match) => match[1]!,
          ),
        );
        expect(anchors.size).toBe(3);
        for (const anchor of anchors)
          expect(japanese).toContain(`id="${anchor}"`);
        expect(japanese).toContain("二つの有限数を加算");
      }
    },
  );
  japaneseIt(
    "uses validated translated titles and falls back for untranslated sources without AI",
    async () => {
      const { project } = await fixture();
      const canonical = await readFile(
        join(project, "requirements.md"),
        "utf8",
      );
      await writeFile(
        join(project, "ja.md"),
        canonical.replace("Add two numbers", "二つの数を加算"),
      );
      await writeFile(
        join(project, "views.json"),
        JSON.stringify({ "requirements.md": "ja.md" }),
      );
      const result = await reportProjectDirectory(project, {
        japaneseViews: "views.json",
      });
      expect(result.overviewPath, result.errors.join("\n")).toBeDefined();
      const html = await readFile(result.outputPath!, "utf8");
      expect(html).toContain('data-ja="二つの数を加算"');
      const source = await readFile(
        join(
          dirname(result.outputPath!),
          "sources",
          requirementSourceFilename("specification.md"),
        ),
        "utf8",
      );
      expect(source).toContain(
        "Japanese translation unavailable; showing English.",
      );
      expect(source).not.toContain("template data-translation");
    },
  );

  japaneseIt(
    "rejects changed IDs, code, and unknown source mappings before publishing",
    async () => {
      const { project } = await fixture();
      await writeFile(join(project, "ja.md"), "## REQ-999 不正\n");
      await writeFile(
        join(project, "views.json"),
        JSON.stringify({ "requirements.md": "ja.md" }),
      );
      const result = await reportProjectDirectory(project, {
        japaneseViews: "views.json",
      });
      expect(result.exitCode).toBe(1);
      expect(result.errors.join("\n")).toContain("Invalid Japanese view");
      expect(await readdir(project)).not.toContain("moura-report");
      await writeFile(
        join(project, "views.json"),
        JSON.stringify({ "unknown.md": "ja.md" }),
      );
      expect(
        (
          await reportProjectDirectory(project, { japaneseViews: "views.json" })
        ).errors.join("\n"),
      ).toContain("Unknown Japanese view source");
    },
  );
});
