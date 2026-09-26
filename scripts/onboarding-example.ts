import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import console from "node:console";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runCommand } from "./run-command.js";

const root = resolve(import.meta.dirname, "..");
const evidencePath = join(
  root,
  "allure-results",
  "moura-onboarding-example-result.json",
);

export interface OnboardingExampleOptions {
  /** An exact registry package spec. Omit only for the existing local-pack smoke. */
  readonly mouraPackageSpec?: string;
  readonly expectedVersion?: string;
  readonly writeDogfoodingEvidence?: boolean;
}

function run(command: string, args: readonly string[], cwd: string): string {
  const result = runCommand(command, args, { cwd });
  return `${result.stdout}${result.stderr}`;
}

function expectMissingEvidence(project: string): void {
  try {
    run(
      "pnpm",
      ["exec", "moura", "check", ".", "--strict-traceability"],
      project,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("MISSING REQ-001/SCN-001/CASE-001 [unit]")
    )
      return;
    throw error;
  }
  throw new Error("Moura check passed without current-run Evidence");
}

interface AllureResult {
  readonly status?: unknown;
  readonly labels?: readonly {
    readonly name?: unknown;
    readonly value?: unknown;
  }[];
}

function hasLabel(result: AllureResult, name: string, value: string): boolean {
  return (
    result.labels?.some(
      (label) => label.name === name && label.value === value,
    ) ?? false
  );
}

async function verifyExampleResult(project: string): Promise<void> {
  const resultsDirectory = join(project, "allure-results");
  const entries = await readdir(resultsDirectory);
  const resultFiles = entries.filter((entry) => entry.endsWith("-result.json"));
  if (resultFiles.length !== 1)
    throw new Error(`Expected one Allure result, found ${resultFiles.length}`);

  const source = join(resultsDirectory, resultFiles[0]!);
  const result = JSON.parse(await readFile(source, "utf8")) as AllureResult;
  const expected = [
    ["moura_traceability", "managed"],
    ["moura_requirement", "REQ-001"],
    ["moura_scenario", "SCN-001"],
    ["moura_case", "CASE-001"],
    ["moura_layer", "unit"],
    ["epic", "REQ-001"],
    ["feature", "SCN-001"],
    ["story", "CASE-001"],
  ] as const;
  if (result.status !== "passed") throw new Error("Example test did not pass");
  for (const [name, value] of expected) {
    if (!hasLabel(result, name, value))
      throw new Error(`Example result is missing ${name}=${value}`);
  }
}

const staleExampleEvidence = {
  name: "stale passing result",
  status: "passed",
  labels: [
    { name: "moura_traceability", value: "managed" },
    { name: "moura_requirement", value: "REQ-001" },
    { name: "moura_scenario", value: "SCN-001" },
    { name: "moura_case", value: "CASE-001" },
    { name: "moura_layer", value: "unit" },
  ],
};

async function seedStaleExampleEvidence(project: string): Promise<void> {
  const resultsDirectory = join(project, "allure-results");
  await mkdir(resultsDirectory, { recursive: true });
  await writeFile(
    join(resultsDirectory, "stale-result.json"),
    `${JSON.stringify(staleExampleEvidence, undefined, 2)}\n`,
  );
}

async function verifyResultsRemoved(project: string): Promise<void> {
  let resultsExist = true;
  try {
    await access(join(project, "allure-results"));
  } catch {
    resultsExist = false;
  }
  if (resultsExist) throw new Error("Stale Allure results were not removed");
}

const onboardingEvidence = {
  name: "runs the official Vitest and Allure onboarding flow",
  status: "passed",
  labels: [
    { name: "moura_traceability", value: "managed" },
    { name: "moura_requirement", value: "REQ-007" },
    { name: "moura_scenario", value: "SCN-001" },
    { name: "moura_case", value: "CASE-001" },
    { name: "moura_requirement", value: "REQ-007" },
    { name: "moura_scenario", value: "SCN-001" },
    { name: "moura_case", value: "CASE-002" },
    { name: "moura_requirement", value: "REQ-007" },
    { name: "moura_scenario", value: "SCN-001" },
    { name: "moura_case", value: "CASE-003" },
    { name: "moura_layer", value: "integration" },
    { name: "epic", value: "REQ-007" },
    { name: "feature", value: "SCN-001" },
    { name: "story", value: "CASE-001" },
  ],
};

export async function runOnboardingExample({
  mouraPackageSpec,
  expectedVersion,
  writeDogfoodingEvidence = true,
}: OnboardingExampleOptions = {}): Promise<void> {
  await rm(evidencePath, { force: true });
  const temporary = await mkdtemp(join(tmpdir(), "moura-onboarding-"));
  const project = join(temporary, "vitest-minimal");
  try {
    await cp(join(root, "examples/vitest-minimal"), project, {
      recursive: true,
    });
    let packageSpec = mouraPackageSpec;
    if (packageSpec === undefined) {
      const packed = run(
        "pnpm",
        ["pack", "--pack-destination", temporary],
        root,
      );
      const tarballName = packed.trim().split(/\r?\n/u).at(-1);
      if (!tarballName) throw new Error("pnpm pack did not report a tarball");
      packageSpec = join(temporary, basename(tarballName));
      await access(packageSpec, constants.R_OK);
    }

    const packagePath = join(project, "package.json");
    const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as {
      devDependencies: Record<string, string>;
    };
    packageJson.devDependencies["@specxai/moura"] = packageSpec;
    await writeFile(
      packagePath,
      `${JSON.stringify(packageJson, undefined, 2)}\n`,
    );

    run("pnpm", ["install", "--ignore-workspace"], project);
    if (expectedVersion !== undefined) {
      const version = run(
        "pnpm",
        ["exec", "moura", "--version"],
        project,
      ).trim();
      if (version !== `moura ${expectedVersion}`)
        throw new Error(
          `Installed CLI version (${version}) does not match released version (${expectedVersion})`,
        );
    }
    run("pnpm", ["exec", "moura", "validate", "."], project);

    await seedStaleExampleEvidence(project);
    run("pnpm", ["run", "clean:results"], project);
    await verifyResultsRemoved(project);
    expectMissingEvidence(project);

    await seedStaleExampleEvidence(project);
    run("pnpm", ["test"], project);
    run("pnpm", ["run", "verify:results"], project);
    await verifyExampleResult(project);
    const checkOutput = run(
      "pnpm",
      ["exec", "moura", "check", ".", "--strict-traceability"],
      project,
    );
    if (/\b(?:MISSING|UNMAPPED)\b|Evidence mapping error/iu.test(checkOutput))
      throw new Error(
        `Unexpected strict traceability diagnostic:\n${checkOutput}`,
      );
    run("pnpm", ["exec", "moura", "report", "."], project);

    const report = await readFile(
      join(project, "moura-report/index.html"),
      "utf8",
    );
    if (!report.includes("REQ-001/SCN-001/CASE-001"))
      throw new Error(
        "Example Requirement Coverage report is empty or incomplete",
      );

    if (writeDogfoodingEvidence) {
      await mkdir(join(root, "allure-results"), { recursive: true });
      await writeFile(
        evidencePath,
        `${JSON.stringify(onboardingEvidence, undefined, 2)}\n`,
      );
    }
    console.log("External-user-style onboarding example passed.");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await runOnboardingExample();
