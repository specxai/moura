import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";

import { verifyRegistryDependency } from "./onboarding-example.js";
import { normalizeDistTag, parseDistTagVersion } from "./registry-smoke.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-006/SCN-001/CASE-002"], "unit");

describe("registry smoke", () => {
  it("recognizes an exact registry dependency and rejects a local link", async () => {
    const project = await mkdtemp(join(tmpdir(), "moura-registry-test-"));
    try {
      await writeFile(
        join(project, "package.json"),
        `${JSON.stringify({ devDependencies: { "@specxai/moura": "0.1.2" } })}\n`,
      );
      await writeFile(
        join(project, "pnpm-lock.yaml"),
        [
          "lockfileVersion: '9.0'",
          "importers:",
          "  .:",
          "    devDependencies:",
          "      '@specxai/moura':",
          "        specifier: 0.1.2",
          "        version: 0.1.2",
          "packages:",
          "  '@specxai/moura@0.1.2':",
          "    resolution:",
          "      integrity: sha512-registry-content",
          "",
        ].join("\n"),
      );

      await expect(verifyRegistryDependency(project, "0.1.2")).resolves.toBe(
        undefined,
      );

      await writeFile(
        join(project, "package.json"),
        `${JSON.stringify({ devDependencies: { "@specxai/moura": "@specxai/moura@0.1.2" } })}\n`,
      );
      await expect(verifyRegistryDependency(project, "0.1.2")).rejects.toThrow(
        "dependency value 0.1.2",
      );
    } finally {
      await rm(project, { recursive: true, force: true });
    }
  });

  it("reads the latest dist-tag from registry metadata", () => {
    expect(
      parseDistTagVersion(
        JSON.stringify({ latest: "1.2.3", "release.1": "1.2.2" }),
        "latest",
      ),
    ).toBe("1.2.3");
  });

  it("treats a dotted dist-tag as one literal key", () => {
    expect(
      parseDistTagVersion(
        JSON.stringify({ latest: "1.2.3", "release.1": "1.2.2" }),
        "release.1",
      ),
    ).toBe("1.2.2");
  });

  it("uses the normalized uppercase dist-tag for literal-key lookup", () => {
    const distTag = normalizeDistTag(" BETA ");
    expect(
      parseDistTagVersion(
        JSON.stringify({ BETA: "1.2.2", " BETA ": "9.9.9" }),
        distTag,
      ),
    ).toBe("1.2.2");
  });

  it.each([
    ["latest", "latest"],
    ["release.1", "release.1"],
    ["release_candidate", "release_candidate"],
    ["release-candidate", "release-candidate"],
    ["BETA", "BETA"],
    ["BETA ", "BETA"],
    [" BETA", "BETA"],
    [" BETA ", "BETA"],
  ])("normalizes npm-compatible dist-tag %j to %j", (raw, normalized) => {
    expect(normalizeDistTag(raw)).toBe(normalized);
  });

  it.each(["", "   ", "1.2.3", "v1.4", "foo bar", "@bad"])(
    "rejects invalid npm dist-tag %j",
    (distTag) => {
      expect(() => normalizeDistTag(distTag)).toThrow("Invalid npm dist-tag");
    },
  );
});
