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
import assert from "node:assert/strict";
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
    { name: "moura_requirement", value: "REQ-010" },
    { name: "moura_scenario", value: "SCN-001" },
    { name: "moura_case", value: "CASE-001" },
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
    assert.match(report.toString(), /Overall Status/u);
    const example = join(temporary, "vitest-minimal");
    await cp(join(root, "examples/vitest-minimal"), example, {
      recursive: true,
    });
    await cp(join(fixture, "allure-results"), join(example, "allure-results"), {
      recursive: true,
    });
    // A single required unit pair, using external-tool-style runtime Evidence.
    await rm(join(example, "allure-results/integration-result.json"));
    run(binary, ["validate", example], packageDirectory);
    run(binary, ["report", example], packageDirectory);
    const overview = await readFile(
      join(example, "moura-report/index.html"),
      "utf8",
    );
    assert.match(overview, /data-status="PASS"/u);
    const existingReport = join(example, "moura-report");
    assert.throws(
      () => run(binary, ["report", example], packageDirectory),
      /Output already exists/u,
    );
    assert.equal(
      await readFile(join(existingReport, "index.html"), "utf8"),
      overview,
    );
    await rm(existingReport, { recursive: true });
    run(binary, ["report", example], packageDirectory);
    assert.match(overview, /href="\.\/moura\/index\.html"/u);
    assert.doesNotMatch(overview, /href="\.\/(?:allure|coverage)\/"/u);
    const map = await readFile(
      join(example, "moura-report/moura/index.html"),
      "utf8",
    );
    assert.match(map, /REQ-001\/SCN-001\/CASE-001/u);
    for (const [, path] of map.matchAll(
      /href="\.\/sources\/([^"#]+)(?:#[^"]*)?"/gu,
    ))
      await access(join(example, "moura-report/moura/sources", path!));
    run(
      binary,
      ["report", example, "--output", "reports/quality"],
      packageDirectory,
    );
    await access(join(example, "reports/quality/index.html"));
    const absolute = join(temporary, "absolute-report");
    run(binary, ["report", example, "--output", absolute], packageDirectory);
    await access(join(absolute, "moura/index.html"));
    // The packed package deliberately excludes all repository scripts and dev tools.
    const installedRoot = join(
      packageDirectory,
      "node_modules",
      "@specxai/moura",
    );
    await assert.rejects(access(join(installedRoot, "scripts")));
    await assert.rejects(access(join(packageDirectory, "node_modules/vitest")));
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
