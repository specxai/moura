import console from "node:console";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import npa from "npm-package-arg";
import semver from "semver";

import { runOnboardingExample } from "./onboarding-example.js";
import { runCommand } from "./run-command.js";

const packageName = "@specxai/moura";
const retryDelays = [0, 5_000, 10_000, 20_000, 30_000, 30_000, 30_000];

function npmView(spec: string, field: string): string {
  return runCommand("npm", ["view", spec, field, "--json"]).stdout.trim();
}

function parseNpmString(value: string, description: string): string {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "string")
    throw new Error(`npm returned an invalid ${description}: ${value}`);
  return parsed;
}

export function parseDistTagVersion(value: string, distTag: string): string {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`npm returned invalid dist-tags: ${value}`);
  const tagged = Object.hasOwn(parsed, distTag)
    ? (parsed as Record<string, unknown>)[distTag]
    : undefined;
  if (typeof tagged !== "string")
    throw new Error(`npm dist-tag ${distTag} is missing or invalid`);
  return tagged;
}

export function normalizeDistTag(rawDistTag: string): string {
  const distTag = rawDistTag.trim();
  try {
    // Match npm CLI's validation rather than maintaining a separate tag grammar.
    npa(`${packageName}@${distTag}`);
  } catch {
    throw new Error(`Invalid npm dist-tag: ${distTag}`);
  }
  if (distTag.length === 0 || semver.validRange(distTag) !== null)
    throw new Error(`Invalid npm dist-tag: ${distTag}`);
  return distTag;
}

export async function waitForPublishedVersion(
  version: string,
  distTag: string,
): Promise<void> {
  let lastError: unknown;
  for (const wait of retryDelays) {
    if (wait > 0) await delay(wait);
    try {
      const published = parseNpmString(
        npmView(`${packageName}@${version}`, "version"),
        "package version",
      );
      const tagged = parseDistTagVersion(
        npmView(packageName, "dist-tags"),
        distTag,
      );
      if (published !== version)
        throw new Error(
          `Registry returned version ${published}, expected ${version}`,
        );
      if (tagged !== version)
        throw new Error(
          `Registry dist-tag ${distTag} points to ${tagged}, expected ${version}`,
        );
      return;
    } catch (error) {
      lastError = error;
      console.warn(
        `Published package is not ready in the registry (${error instanceof Error ? error.message : String(error)})`,
      );
    }
  }
  throw new Error(
    `Released artifact ${packageName}@${version} did not become verifiable in the npm registry`,
    { cause: lastError },
  );
}

export async function runRegistrySmoke(
  version: string,
  rawDistTag = "latest",
): Promise<void> {
  if (!/^\d+\.\d+\.\d+$/u.test(version))
    throw new Error(
      `Release version must have the form X.Y.Z; received: ${version}`,
    );
  const distTag = normalizeDistTag(rawDistTag);

  await waitForPublishedVersion(version, distTag);
  await runOnboardingExample({
    mouraPackageSpec: `${packageName}@${version}`,
    expectedVersion: version,
    writeDogfoodingEvidence: false,
  });
  console.log(
    `Post-publish registry smoke passed for ${packageName}@${version}.`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const version = process.argv[2];
  if (version === undefined)
    throw new Error("Usage: registry-smoke.ts <release-version> [dist-tag]");
  await runRegistrySmoke(version, process.argv[3]);
}
