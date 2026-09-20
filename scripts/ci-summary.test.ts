import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";

import { readAllureCounts } from "./ci-summary.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-005/SCN-002/CASE-003"], "unit");

describe("CI summary Allure counts", () => {
  it("counts only Allure test result files by status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-ci-summary-"));
    try {
      await Promise.all([
        ...["passed", "failed", "broken", "skipped", "passed"].map(
          (status, index) =>
            writeFile(
              join(directory, `${index}-result.json`),
              JSON.stringify({ status }),
            ),
        ),
        writeFile(join(directory, "container.json"), "not result JSON"),
      ]);

      await expect(readAllureCounts(directory)).resolves.toEqual({
        tests: 5,
        passed: 2,
        failed: 1,
        broken: 1,
        skipped: 1,
      });
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("identifies malformed result JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-ci-summary-"));
    try {
      await writeFile(join(directory, "bad-result.json"), "{");
      await expect(readAllureCounts(directory)).rejects.toThrow(
        /bad-result\.json/u,
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("rejects an unsupported result status", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-ci-summary-"));
    try {
      await writeFile(
        join(directory, "unknown-result.json"),
        JSON.stringify({ status: "unknown" }),
      );
      await expect(readAllureCounts(directory)).rejects.toThrow(
        /unsupported status "unknown"/u,
      );
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
