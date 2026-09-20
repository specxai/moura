import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it as vitestIt, vi } from "vitest";

import { mouraEvidenceTest } from "./test-support/moura-evidence.js";

const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-003/SCN-001/CASE-001"],
  "integration",
);

const validManifest = `
version: 1
sources:
  requirements: [req.md]
  specifications: [spec.md]
verification:
  layers: [unit]
requirements:
  - id: REQ-001
    scenarios:
      - id: SCN-001
        cases:
          - id: CASE-001
            verify: [unit]
`;

async function run(args: readonly string[], cwd: string) {
  const originalArgv = process.argv;
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;
  const stdout: string[] = [];
  const stderr: string[] = [];
  const log = vi
    .spyOn(console, "log")
    .mockImplementation((...values) => stdout.push(values.join(" ")));
  const error = vi
    .spyOn(console, "error")
    .mockImplementation((...values) => stderr.push(values.join(" ")));

  try {
    process.argv = [process.execPath, "moura", ...args];
    process.chdir(cwd);
    process.exitCode = undefined;
    vi.resetModules();
    await import("./cli.js");
    return {
      status: process.exitCode ?? 0,
      stdout: `${stdout.join("\n")}\n`,
      stderr: `${stderr.join("\n")}\n`,
    };
  } finally {
    process.argv = originalArgv;
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    log.mockRestore();
    error.mockRestore();
  }
}

async function writeValidProject(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(join(directory, "moura.yaml"), validManifest),
    writeFile(join(directory, "req.md"), "# Requirements\n\n## REQ-001\n"),
    writeFile(
      join(directory, "spec.md"),
      "# Specification\n\n## REQ-001\n### SCN-001\n#### CASE-001\n",
    ),
  ]);
}

async function writeEvidence(
  directory: string,
  status: "passed" | "failed" | "broken" | "skipped" = "passed",
  caseId = "REQ-001/SCN-001/CASE-001",
): Promise<void> {
  const results = join(directory, "allure-results");
  await mkdir(results);
  await writeFile(
    join(results, "test-result.json"),
    JSON.stringify({
      status,
      labels: [
        { name: "moura_requirement", value: caseId.split("/")[0] },
        { name: "moura_scenario", value: caseId.split("/")[1] },
        { name: "moura_case", value: caseId.split("/")[2] },
        { name: "moura_layer", value: "unit" },
      ],
    }),
  );
}

describe("CLI", () => {
  it("validates the current working directory when no directory is given", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-cli-test-"));
    try {
      await writeValidProject(directory);
      const result = await run(["validate"], directory);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/Traceability is valid/u);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("validates the requested relative directory instead of the invalid cwd", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-cli-test-"));
    try {
      await writeValidProject(join(directory, "valid-project"));
      const result = await run(["validate", "valid-project"], directory);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toMatch(/Traceability is valid/u);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("fails for a missing project directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-cli-test-"));
    try {
      const result = await run(["validate", "missing-project"], directory);
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/validation failed/u);
      expect(result.stderr).toMatch(/Cannot read configured manifest source/u);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("lists every available command", async () => {
    for (const args of [[], ["--help"]]) {
      const help = await run(args, process.cwd());
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toMatch(
        /^Available commands: validate, check, report\.$/mu,
      );
    }
  });

  it("checks the current working directory and passes complete evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-cli-test-"));
    try {
      await writeValidProject(directory);
      await writeEvidence(directory);
      const result = await run(["check"], directory);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("PASS REQ-001/SCN-001/CASE-001 [unit]");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("checks an explicitly supplied relative directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-cli-test-"));
    try {
      const project = join(directory, "project");
      await writeValidProject(project);
      await writeEvidence(project);
      expect((await run(["check", "project"], directory)).status).toBe(0);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("rejects extra check arguments", async () => {
    const result = await run(["check", "a", "b"], process.cwd());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Usage: moura check [directory] [--strict-traceability]",
    );
  });

  it("renders UNMAPPED as a warning by default and an error in strict mode", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-cli-test-"));
    try {
      await writeValidProject(directory);
      await writeEvidence(directory);
      await writeFile(
        join(directory, "allure-results", "unmapped-result.json"),
        JSON.stringify({
          name: "unmapped CLI test",
          status: "passed",
          labels: [{ name: "moura_traceability", value: "managed" }],
        }),
      );

      const normal = await run(["check"], directory);
      expect(normal.status).toBe(0);
      expect(normal.stderr).toContain("WARNING UNMAPPED unmapped CLI test");

      const strict = await run(
        ["check", ".", "--strict-traceability"],
        directory,
      );
      expect(strict.status).toBe(1);
      expect(strict.stderr).toContain("ERROR UNMAPPED unmapped CLI test");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("cannot inject additional CLI diagnostics through an unmapped result name", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-cli-test-"));
    try {
      await writeValidProject(directory);
      await writeEvidence(directory);
      await writeFile(
        join(directory, "allure-results", "unsafe-result.json"),
        JSON.stringify({
          name: "normal\nERROR FAKE\r\u001b[2JUnicode 😀",
          labels: [{ name: "moura_traceability", value: "managed" }],
        }),
      );

      const result = await run(["check"], directory);
      expect(result.status).toBe(0);
      expect(result.stderr).toContain(
        'WARNING UNMAPPED "normal\\nERROR FAKE\\r\\u001b[2JUnicode 😀"',
      );
      expect(result.stderr.match(/^ERROR FAKE/gmu)).toBeNull();
      expect(result.stderr).not.toContain("\r");
      expect(result.stderr).not.toContain(String.fromCharCode(0x1b));
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("generates a requirement coverage report for an explicit project", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-cli-test-"));
    try {
      const project = join(directory, "project");
      await writeValidProject(project);
      await writeEvidence(project);
      const result = await run(["report", "project"], directory);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("Requirement coverage report");
      expect(
        await readFile(join(project, "moura-report/index.html"), "utf8"),
      ).toContain("REQ-001/SCN-001/CASE-001");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("displays semantic evidence diagnostics when report generation fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-cli-test-"));
    try {
      await writeValidProject(directory);
      await writeEvidence(directory, "passed", "REQ-999/SCN-001/CASE-001");
      const result = await run(["report"], directory);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("unknown-evidence-id");
      expect(result.stderr).toContain("REQ-999/SCN-001/CASE-001 [unit]");
      expect(
        await readFile(join(directory, "moura-report/index.html"), "utf8"),
      ).toContain("unknown-evidence-id");
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("rejects extra report arguments", async () => {
    const result = await run(["report", "a", "b"], process.cwd());
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Usage: moura report [directory]");
  });

  it("preserves version behavior", async () => {
    const version = await run(["--version"], process.cwd());
    const packageJson = JSON.parse(await readFile("package.json", "utf8"));
    expect(version.status, version.stderr).toBe(0);
    expect(version.stdout.trim()).toBe(`moura ${packageJson.version}`);
  });
});
