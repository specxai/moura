import { readFileSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import console from "node:console";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import process from "node:process";

import { parseManifest } from "../src/manifest.js";

import {
  parseAllureResult,
  validateCompleteMouraDogfoodResults,
  validateMouraEvidenceResults,
  verifyRepresentativeResult,
} from "./verify-allure-results.js";

const resultsDirectory = "allure-results";
rmSync(resultsDirectory, { recursive: true, force: true });

const require = createRequire(import.meta.url);
const vitestPackagePath = require.resolve("vitest/package.json");
const vitestPackage: unknown = JSON.parse(
  readFileSync(vitestPackagePath, "utf8"),
);
const bin =
  typeof vitestPackage === "object" &&
  vitestPackage !== null &&
  "bin" in vitestPackage
    ? vitestPackage.bin
    : undefined;
const vitestBin =
  typeof bin === "string"
    ? bin
    : typeof bin === "object" &&
        bin !== null &&
        "vitest" in bin &&
        typeof bin.vitest === "string"
      ? bin.vitest
      : undefined;
if (!vitestBin)
  throw new Error("vitest package metadata does not expose its CLI");
const vitestCliPath = resolve(dirname(vitestPackagePath), vitestBin);
const run = spawnSync(
  process.execPath,
  [vitestCliPath, "run", "--config", "vitest.allure.config.ts"],
  { stdio: "inherit" },
);
if (run.error) throw run.error;
if (run.status !== 0) process.exit(run.status ?? 1);

const parsedManifest = parseManifest(readFileSync("moura.yaml", "utf8"));
if (!parsedManifest.value || parsedManifest.errors.length > 0)
  throw new Error("Cannot load moura.yaml for Allure verification");
const manifest = parsedManifest.value;
const verificationLayersByCase = new Map<string, ReadonlySet<string>>();
for (const requirement of manifest.requirements) {
  for (const scenario of requirement.scenarios) {
    for (const testCase of scenario.cases) {
      const caseId = `${requirement.localId}/${scenario.localId}/${testCase.localId}`;
      verificationLayersByCase.set(caseId, new Set(testCase.verify));
    }
  }
}
const layers = new Set(manifest.verificationLayers);

const results = readdirSync(resultsDirectory)
  .filter((file) => file.endsWith("-result.json"))
  .map((file) => {
    const path = `${resultsDirectory}/${file}`;
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parseAllureResult(value, path);
  });

validateMouraEvidenceResults(results, verificationLayersByCase, layers);
validateCompleteMouraDogfoodResults(results);
verifyRepresentativeResult(
  results,
  "aggregates an empty set of evidence as MISSING",
  ["REQ-002/SCN-001/CASE-002"],
  "unit",
);
verifyRepresentativeResult(
  results,
  "aggregates passed and skipped evidence as PASS",
  ["REQ-002/SCN-001/CASE-001", "REQ-002/SCN-001/CASE-005"],
  "unit",
);

console.log(
  `Verified complete Moura metadata for ${results.length} generated Allure results.`,
);
