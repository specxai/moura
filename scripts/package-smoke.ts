import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import console from "node:console";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runCommand } from "./run-command.js";

const root = resolve(import.meta.dirname, "..");
const evidencePath = join(
  root,
  "allure-results",
  "moura-package-smoke-result.json",
);

const packageSmokeEvidence = {
  name: "supports the documented contract through the installed package boundary",
  status: "passed",
  labels: [
    { name: "moura_traceability", value: "managed" },
    { name: "moura_requirement", value: "REQ-006" },
    { name: "moura_scenario", value: "SCN-001" },
    { name: "moura_case", value: "CASE-001" },
    { name: "moura_requirement", value: "REQ-006" },
    { name: "moura_scenario", value: "SCN-001" },
    { name: "moura_case", value: "CASE-002" },
    { name: "moura_layer", value: "integration" },
    { name: "epic", value: "REQ-006" },
    { name: "feature", value: "SCN-001" },
    { name: "story", value: "CASE-001" },
  ],
};

interface PackageMetadata {
  readonly name: string;
  readonly version: string;
  readonly bin?: Readonly<Record<string, string>>;
}

function parsePackageMetadata(text: string, source: string): PackageMetadata {
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    typeof value.name !== "string" ||
    !("version" in value) ||
    typeof value.version !== "string"
  )
    throw new Error(`${source} has invalid package metadata`);
  const bin = "bin" in value ? value.bin : undefined;
  if (
    bin !== undefined &&
    (typeof bin !== "object" ||
      bin === null ||
      !Object.values(bin).every((entry) => typeof entry === "string"))
  )
    throw new Error(`${source} has invalid package binaries`);
  return {
    name: value.name,
    version: value.version,
    ...(bin === undefined
      ? {}
      : { bin: bin as Readonly<Record<string, string>> }),
  };
}

function run(command: string, args: readonly string[], cwd = root): string {
  const result = runCommand(command, args, { cwd });
  return `${result.stdout}${result.stderr}`;
}

export async function runPackageSmoke(): Promise<void> {
  await rm(evidencePath, { force: true });
  const temporary = await mkdtemp(join(tmpdir(), "moura-package-smoke-"));
  const packageDirectory = join(temporary, "consumer");
  const fixture = join(temporary, "passing-project");
  try {
    await cp(join(root, "test/fixtures/passing-project"), fixture, {
      recursive: true,
    });
    const packed = run("pnpm", ["pack", "--pack-destination", temporary]);
    const tarballName = packed.trim().split(/\r?\n/u).at(-1);
    if (!tarballName) throw new Error("pnpm pack did not report a tarball");
    const tarball = join(temporary, basename(tarballName));
    await access(tarball);
    await rm(packageDirectory, { recursive: true, force: true });
    await mkdir(packageDirectory, { recursive: true });
    run("npm", ["init", "-y"], packageDirectory);
    run("npm", ["install", tarball], packageDirectory);
    const binary = join(packageDirectory, "node_modules", ".bin", "moura");
    const packageJsonPath = join(root, "package.json");
    const packageJson = parsePackageMetadata(
      await readFile(packageJsonPath, "utf8"),
      packageJsonPath,
    );
    const installedPackageJsonPath = join(
      packageDirectory,
      "node_modules",
      ...packageJson.name.split("/"),
      "package.json",
    );
    const installedPackageJson = parsePackageMetadata(
      await readFile(installedPackageJsonPath, "utf8"),
      installedPackageJsonPath,
    );
    if (installedPackageJson.name !== "@specxai/moura")
      throw new Error(`Unexpected package name: ${installedPackageJson.name}`);
    if (installedPackageJson.bin?.moura !== "dist/cli.js")
      throw new Error("Installed package does not expose the moura CLI");
    if (installedPackageJson.version !== packageJson.version)
      throw new Error(
        `Installed package version (${installedPackageJson.version}) does not match source (${packageJson.version})`,
      );
    const version = run(binary, ["--version"], packageDirectory);
    if (version.trim() !== `moura ${packageJson.version}`)
      throw new Error(`Unexpected version: ${version}`);
    run(binary, ["--help"], packageDirectory);
    run(binary, ["validate", fixture], packageDirectory);
    run(binary, ["check", fixture], packageDirectory);
    run(binary, ["report", fixture], packageDirectory);
    const report = await readFile(join(fixture, "moura-report", "index.html"));
    if (report.byteLength === 0)
      throw new Error("Installed package generated an empty coverage report");
    await mkdir(join(root, "allure-results"), { recursive: true });
    await writeFile(
      evidencePath,
      `${JSON.stringify(packageSmokeEvidence, undefined, 2)}\n`,
    );
    console.log("Packed package installed CLI smoke test passed.");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  await runPackageSmoke();
