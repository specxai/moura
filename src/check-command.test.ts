import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it as vitestIt, vi } from "vitest";

import { checkProjectDirectory } from "./check-command.js";
import {
  mouraEvidenceName,
  mouraEvidenceTest,
} from "./test-support/moura-evidence.js";

const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-003/SCN-002/CASE-001"],
  "integration",
);

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function project(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "moura-check-command-"));
  directories.push(directory);
  await Promise.all([
    writeFile(
      join(directory, "moura.yaml"),
      `
version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit] }
requirements:
  - id: REQ-001
    scenarios:
      - id: SCN-001
        cases:
          - { id: CASE-001, verify: [unit] }
`,
    ),
    writeFile(join(directory, "req.md"), "## REQ-001 Requirement\n"),
    writeFile(
      join(directory, "spec.md"),
      "## REQ-001 Requirement\n### SCN-001 Scenario\n#### CASE-001 Case\n",
    ),
  ]);
  return directory;
}

async function resultFile(directory: string, value: unknown): Promise<void> {
  const results = join(directory, "allure-results");
  await mkdir(results, { recursive: true });
  await writeFile(
    join(results, "one-result.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

function allure(
  status: string,
  caseId = "REQ-001/SCN-001/CASE-001",
  labels = true,
) {
  const [requirement, scenario, testCase] = caseId.split("/");
  const hierarchy = [
    { name: "moura_requirement", value: requirement },
    { name: "moura_scenario", value: scenario },
    { name: "moura_case", value: testCase },
  ];
  return {
    status,
    labels: labels
      ? [...hierarchy, { name: "moura_layer", value: "unit" }]
      : hierarchy,
  };
}

describe("check project command", () => {
  it(
    mouraEvidenceName(
      "aggregates multiple records and layers through the filesystem command",
      ["REQ-002/SCN-001/CASE-005"],
      "integration",
    ),
    async () => {
      const directory = await project();
      await writeFile(
        join(directory, "moura.yaml"),
        `
version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit, integration] }
requirements:
  - id: REQ-001
    scenarios:
      - id: SCN-001
        cases:
          - { id: CASE-001, verify: [unit, integration] }
`,
      );
      const results = join(directory, "allure-results");
      await mkdir(results);
      await Promise.all([
        writeFile(
          join(results, "a-result.json"),
          JSON.stringify(allure("skipped")),
        ),
        writeFile(
          join(results, "b-result.json"),
          JSON.stringify(allure("passed")),
        ),
        writeFile(
          join(results, "c-result.json"),
          JSON.stringify({
            ...allure("passed"),
            labels: [
              { name: "moura_requirement", value: "REQ-001" },
              { name: "moura_scenario", value: "SCN-001" },
              { name: "moura_case", value: "CASE-001" },
              { name: "moura_layer", value: "integration" },
            ],
          }),
        ),
      ]);
      expect((await checkProjectDirectory(directory)).exitCode).toBe(0);
    },
  );
  it.each([
    ["passed", "PASS", 0],
    ["failed", "FAIL", 1],
    ["broken", "BROKEN", 1],
    ["skipped", "SKIPPED", 0],
  ] as const)(
    "renders %s evidence as %s",
    async (status, rendered, exitCode) => {
      const directory = await project();
      await resultFile(directory, allure(status));
      const result = await checkProjectDirectory(directory);
      expect(result.exitCode).toBe(exitCode);
      expect(result.stdout).toContain(
        `${rendered} REQ-001/SCN-001/CASE-001 [unit] (${exitCode === 0 && rendered === "PASS" ? "success" : exitCode === 0 ? "warning" : "error"})`,
      );
    },
  );

  it("renders MISSING for a usable empty results directory", async () => {
    const directory = await project();
    await mkdir(join(directory, "allure-results"));
    const result = await checkProjectDirectory(directory);
    expect(result.exitCode).toBe(1);
    expect(result.stdout[0]).toMatch(/^MISSING /u);
    expect(result.stderr).toEqual([]);
  });

  it(
    mouraEvidenceName(
      "renders explicit UNIMPLEMENTED as a successful warning",
      ["REQ-002/SCN-001/CASE-011"],
      "integration",
    ),
    async () => {
      const directory = await project();
      await writeFile(
        join(directory, "moura.yaml"),
        (
          await import("node:fs/promises").then(({ readFile }) =>
            readFile(join(directory, "moura.yaml"), "utf8"),
          )
        ).replace("verify: [unit]", "unimplemented: [unit]"),
      );
      await mkdir(join(directory, "allure-results"));
      const result = await checkProjectDirectory(directory);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(
        "UNIMPLEMENTED REQ-001/SCN-001/CASE-001 [unit] (warning)",
      );
    },
  );

  it("distinguishes a missing results directory from missing evidence", async () => {
    const result = await checkProjectDirectory(await project());
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toMatch(/unreadable-results-directory/u);
  });

  it.each([
    ["malformed JSON", "not json", "malformed-json"],
    [
      "partial labels",
      allure("passed", undefined, false),
      "missing-moura-layer",
    ],
  ])("surfaces %s adapter input", async (_name, input, code) => {
    const directory = await project();
    await resultFile(directory, input);
    const result = await checkProjectDirectory(directory);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain(code);
    expect(result.stderr.join("\n")).toContain("one-result.json");
  });

  it("surfaces semantic evidence issues", async () => {
    const directory = await project();
    await resultFile(directory, allure("passed", "REQ-999/SCN-001/CASE-001"));
    const result = await checkProjectDirectory(directory);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain("unknown-evidence-id");
    expect(result.stderr.join("\n")).toContain(
      "REQ-999/SCN-001/CASE-001 [unit]",
    );
  });

  it("warns for managed unmapped results without failing otherwise passing checks", async () => {
    const directory = await project();
    const results = join(directory, "allure-results");
    await mkdir(results);
    await Promise.all([
      writeFile(
        join(results, "mapped-result.json"),
        JSON.stringify(allure("passed")),
      ),
      writeFile(
        join(results, "unmapped-result.json"),
        JSON.stringify({
          name: "unmapped test",
          status: "passed",
          labels: [{ name: "moura_traceability", value: "managed" }],
        }),
      ),
      writeFile(
        join(results, "unrelated-result.json"),
        JSON.stringify({
          name: "unrelated test",
          status: "passed",
          labels: [],
        }),
      ),
    ]);

    const result = await checkProjectDirectory(directory);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "WARNING UNMAPPED unmapped test (unmapped-result.json): No Moura Case is associated with this test result.",
    );
    expect(result.stderr.join("\n")).not.toContain("unrelated test");
  });

  it("promotes managed unmapped results to errors in strict mode", async () => {
    const directory = await project();
    const results = join(directory, "allure-results");
    await mkdir(results);
    await Promise.all([
      writeFile(
        join(results, "mapped-result.json"),
        JSON.stringify(allure("passed")),
      ),
      writeFile(
        join(results, "unmapped-result.json"),
        JSON.stringify({
          name: "unmapped test",
          labels: [{ name: "moura_traceability", value: "managed" }],
        }),
      ),
    ]);

    const result = await checkProjectDirectory(directory, {
      strictTraceability: true,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr[0]).toMatch(/^ERROR UNMAPPED unmapped test/u);
  });

  it("renders unsafe unmapped names and sources as exactly one logical diagnostic line", async () => {
    const directory = await project();
    const results = join(directory, "allure-results");
    await mkdir(results);
    await Promise.all([
      writeFile(
        join(results, "mapped-result.json"),
        JSON.stringify(allure("passed")),
      ),
      writeFile(
        join(results, "unsafe\u2028source\u2029-result.json"),
        JSON.stringify({
          name: "test\nERROR injected\r\u001b[31mred\u2028line\u2029paragraph\u202eoverride",
          labels: [{ name: "moura_traceability", value: "managed" }],
        }),
      ),
    ]);

    const result = await checkProjectDirectory(directory);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toHaveLength(1);
    expect(result.stderr[0]).toContain(
      '"test\\nERROR injected\\rred\\u2028line\\u2029paragraph\\u202eoverride"',
    );
    expect(result.stderr[0]).toContain(
      '("unsafe\\u2028source\\u2029-result.json")',
    );
    expect(result.stderr[0]).not.toContain("\r");
    expect(result.stderr[0]).not.toContain("\n");
    expect(result.stderr[0]).not.toContain(String.fromCharCode(0x1b));
    expect(result.stderr[0]).not.toMatch(/[\u2028\u2029]/u);
    expect(result.stderr[0]).not.toMatch(/\p{Bidi_Control}/u);
  });

  it("stops before evidence loading when structural validation fails", async () => {
    const directory = await project();
    await writeFile(join(directory, "req.md"), "# no managed requirement\n");
    const loadEvidence = vi.fn();
    const result = await checkProjectDirectory(directory, { loadEvidence });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.join("\n")).toContain(
      "Traceability validation failed",
    );
    expect(loadEvidence).not.toHaveBeenCalled();
  });
});
