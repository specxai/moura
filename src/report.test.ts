import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "./test-support/moura-evidence.js";

import { checkVerification } from "./check.js";
import { parseManifest } from "./manifest.js";
import { renderCoverageReport, reportProjectDirectory } from "./report.js";

const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-003/SCN-002/CASE-003"],
  "integration",
);

const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  ),
);

const manifest = parseManifest(`
version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit, integration, system, manual, security, future] }
requirements:
  - id: REQ-A&amp;
    scenarios:
      - id: SCN-ONE
        cases:
          - { id: CASE-X, verify: [unit, integration, system, manual, security], unimplemented: [future] }
`).value!;

describe("requirement coverage report", () => {
  it("renders hierarchy, per-layer aggregation, every status, gaps, and escaped identities deterministically", () => {
    const evidence = [
      {
        covers: ["REQ-A&amp;/SCN-ONE/CASE-X"],
        layer: "unit",
        status: "passed" as const,
      },
      {
        covers: ["REQ-A&amp;/SCN-ONE/CASE-X"],
        layer: "integration",
        status: "failed" as const,
      },
      {
        covers: ["REQ-A&amp;/SCN-ONE/CASE-X"],
        layer: "system",
        status: "broken" as const,
      },
      {
        covers: ["REQ-A&amp;/SCN-ONE/CASE-X"],
        layer: "manual",
        status: "skipped" as const,
      },
    ];
    const checked = checkVerification(manifest, evidence);
    const first = renderCoverageReport(manifest, checked);
    expect(renderCoverageReport(manifest, checked)).toBe(first);
    expect(first).toContain(
      '<meta name="format-detection" content="telephone=no">',
    );
    for (const status of [
      "PASS",
      "FAIL",
      "BROKEN",
      "SKIPPED",
      "UNIMPLEMENTED",
      "MISSING",
    ])
      expect(first).toContain(status);
    expect(first).toContain('data-severity="warning"');
    expect(first).toContain('data-severity="error"');
    expect(first).toContain("Per-layer coverage");
    expect(first).toContain("REQ-A&amp;amp;/SCN-ONE/CASE-X");
    expect(first).toContain("0 / 1 (0%)");
  });

  it("rejects an invalid project without writing a report", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(directory);
    const result = await reportProjectDirectory(directory);
    expect(result.exitCode).toBe(1);
    expect(result.outputPath).toBeUndefined();
    await expect(
      readFile(join(directory, "moura-report/index.html")),
    ).rejects.toThrow();
  });

  it("writes diagnostic HTML but fails for invalid normalized evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(directory);
    await Promise.all([
      writeFile(
        join(directory, "moura.yaml"),
        `version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit] }
requirements:
  - id: R
    scenarios:
      - id: S
        cases:
          - { id: C, verify: [unit] }
`,
      ),
      writeFile(join(directory, "req.md"), "## R\n"),
      writeFile(join(directory, "spec.md"), "## R\n### S\n#### C\n"),
      mkdir(join(directory, "allure-results")),
    ]);
    const result = await reportProjectDirectory(directory, {
      loadEvidence: async () => ({
        evidence: [{ covers: ["unknown"], layer: "unit", status: "passed" }],
        issues: [],
      }),
    });
    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      expect.stringContaining(
        'unknown-evidence-id: unknown [unit]: Evidence refers to unknown canonical ID "unknown"',
      ),
    ]);
    expect(await readFile(result.outputPath!, "utf8")).toContain(
      "unknown-evidence-id",
    );
  });

  it("keeps layer context when rendering semantic evidence issues", () => {
    const checked = checkVerification(manifest, [
      { covers: ["unknown"], layer: "unit", status: "passed" },
      { covers: ["unknown"], layer: "integration", status: "passed" },
    ]);
    const html = renderCoverageReport(manifest, checked);
    expect(html).toContain("unknown-evidence-id: unknown [unit]:");
    expect(html).toContain("unknown-evidence-id: unknown [integration]:");
  });

  it("renders reverse traceability diagnostics separately from pair coverage", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(directory);
    await writeProject(directory);
    await writeFile(
      join(directory, "allure-results", "unmapped-result.json"),
      JSON.stringify({
        name: "unmapped report test",
        labels: [{ name: "moura_traceability", value: "managed" }],
      }),
    );

    const result = await reportProjectDirectory(directory);
    expect(result.exitCode).toBe(0);
    const html = await readFile(result.outputPath!, "utf8");
    expect(html).toContain("Reverse traceability diagnostics");
    expect(html).toContain("WARNING UNMAPPED unmapped report test");
    expect(html).toContain("Required Case × layer pairs");

    const strict = await reportProjectDirectory(directory, {
      strictTraceability: true,
    });
    expect(strict.exitCode).toBe(1);
    expect(strict.errors).toContainEqual(
      expect.stringContaining("ERROR UNMAPPED unmapped report test"),
    );
  });

  it("does not render control characters from unmapped result names", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(directory);
    await writeProject(directory);
    await writeFile(
      join(directory, "allure-results", "unsafe\u2028source\u2029-result.json"),
      JSON.stringify({
        name: "Unicode テスト 😀\nERROR injected\r\u001b[31mred\u2028line\u2029paragraph",
        labels: [{ name: "moura_traceability", value: "managed" }],
      }),
    );

    const result = await reportProjectDirectory(directory);
    const html = await readFile(result.outputPath!, "utf8");
    expect(html).toContain(
      "&quot;Unicode テスト 😀\\nERROR injected\\r\\u001b[31mred\\u2028line\\u2029paragraph&quot;",
    );
    expect(html).toContain(
      "(&quot;unsafe\\u2028source\\u2029-result.json&quot;)",
    );
    expect(html).not.toContain("\r");
    expect(html).not.toContain(String.fromCharCode(0x1b));
    expect(html).not.toMatch(/[\u2028\u2029]/u);
    expect(html).not.toContain("テスト 😀\nERROR injected");
  });

  it("identifies adapter issue sources in command and escaped HTML diagnostics", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(directory);
    await writeProject(directory);
    const result = await reportProjectDirectory(directory, {
      loadEvidence: async () => ({
        evidence: [],
        issues: [
          {
            code: "malformed-json",
            message: "Invalid <JSON>",
            source: "broken-result.json",
          },
          { code: "unreadable-results-directory", message: "Cannot read" },
        ],
      }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([
      "malformed-json: broken-result.json: Invalid <JSON>",
      "unreadable-results-directory: Cannot read",
    ]);
    const html = await readFile(result.outputPath!, "utf8");
    expect(html).toContain(
      "malformed-json: broken-result.json: Invalid &lt;JSON&gt;",
    );
    expect(html).toContain("unreadable-results-directory: Cannot read");
    expect(html).not.toContain("undefined");
  });

  it("rejects unsafe evidence identities without placing controls in HTML", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(directory);
    await writeProject(directory);
    await writeFile(
      join(directory, "allure-results", "unsafe-result.json"),
      JSON.stringify({
        status: "passed",
        labels: [
          { name: "moura_requirement", value: "R" },
          { name: "moura_scenario", value: "S" },
          { name: "moura_case", value: "C\u0000ignored" },
          { name: "moura_layer", value: "unit" },
        ],
      }),
    );

    const result = await reportProjectDirectory(directory);
    expect(result.exitCode).toBe(1);
    expect(result.errors).toContain(
      "invalid-moura-case-label: unsafe-result.json: moura_case contains characters or structure not allowed in a local Moura ID",
    );
    const html = await readFile(result.outputPath!, "utf8");
    expect(html).toContain("invalid-moura-case-label");
    expect(html).toContain("unsafe-result.json");
    expect(html).toContain("MISSING");
    expect(html).not.toContain("\u0000");
    expect(html).not.toContain("ignored");
  });

  it("replaces generated output, including stale files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(directory);
    await writeProject(directory);

    const first = await reportProjectDirectory(directory);
    expect(first.exitCode).toBe(0);
    await writeFile(join(directory, "moura-report", "stale.txt"), "stale");
    await writeFile(first.outputPath!, "previous report");

    const second = await reportProjectDirectory(directory);

    expect(second.exitCode).toBe(0);
    expect(await readFile(second.outputPath!, "utf8")).toContain(
      "Requirement Coverage",
    );
    await expect(
      readFile(join(directory, "moura-report", "stale.txt")),
    ).rejects.toThrow();
  });

  it("replaces a hard-linked entry point without modifying its other link", async () => {
    const parent = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(parent);
    const directory = join(parent, "project");
    const outside = join(parent, "outside.html");
    await writeProject(directory);
    await mkdir(join(directory, "moura-report"));
    await writeFile(outside, "outside sentinel");
    await link(outside, join(directory, "moura-report", "index.html"));

    const result = await reportProjectDirectory(directory);

    expect(result.exitCode).toBe(0);
    expect(await readFile(outside, "utf8")).toBe("outside sentinel");
    expect(await readFile(result.outputPath!, "utf8")).toContain(
      "Requirement Coverage",
    );
  });

  it("replaces a symlinked report directory without deleting its target", async () => {
    const parent = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(parent);
    const directory = join(parent, "project");
    const outside = join(parent, "outside");
    await writeProject(directory);
    await mkdir(outside);
    await writeFile(join(outside, "index.html"), "outside sentinel");
    await symlink(outside, join(directory, "moura-report"), "junction");

    const result = await reportProjectDirectory(directory);

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(outside, "index.html"), "utf8")).toBe(
      "outside sentinel",
    );
    expect((await lstat(join(directory, "moura-report"))).isDirectory()).toBe(
      true,
    );
    expect(
      (await lstat(join(directory, "moura-report", "index.html"))).isFile(),
    ).toBe(true);
  });

  it("replaces a symlinked entry point without overwriting its target", async () => {
    const parent = await mkdtemp(join(tmpdir(), "moura-report-test-"));
    directories.push(parent);
    const directory = join(parent, "project");
    const outside = join(parent, "outside.html");
    await writeProject(directory);
    await mkdir(join(directory, "moura-report"));
    await writeFile(outside, "outside sentinel");
    await symlink(outside, join(directory, "moura-report", "index.html"));

    const result = await reportProjectDirectory(directory);

    expect(result.exitCode).toBe(0);
    expect(await readFile(outside, "utf8")).toBe("outside sentinel");
    expect((await lstat(result.outputPath!)).isFile()).toBe(true);
  });
});

async function writeProject(directory: string): Promise<void> {
  await mkdir(join(directory, "allure-results"), { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, "moura.yaml"),
      `version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit] }
requirements:
  - id: R
    scenarios:
      - id: S
        cases:
          - { id: C, verify: [unit] }
`,
    ),
    writeFile(join(directory, "req.md"), "## R\n"),
    writeFile(join(directory, "spec.md"), "## R\n### S\n#### C\n"),
  ]);
}
