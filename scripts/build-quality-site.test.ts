import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";

const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-005/SCN-002/CASE-002"],
  "integration",
);

describe("quality site assembly", () => {
  it("stages all reports and links Requirement Coverage first", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-quality-site-"));
    try {
      for (const report of ["moura-report", "allure-report", "coverage"]) {
        await mkdir(join(directory, report));
        await writeFile(join(directory, report, "index.html"), report);
      }
      const run = spawnSync(
        process.execPath,
        [
          "--import",
          import.meta.resolve("tsx"),
          resolve("scripts/build-quality-site.ts"),
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, GITHUB_SHA: "0123456789abcdef" },
        },
      );
      expect(run.status, run.stderr).toBe(0);
      const landing = await readFile(
        join(directory, "_site/index.html"),
        "utf8",
      );
      expect(landing.indexOf("Requirement Coverage")).toBeLessThan(
        landing.indexOf("Allure Report"),
      );
      expect(landing.indexOf("Allure Report")).toBeLessThan(
        landing.indexOf("Code Coverage"),
      );
      expect(landing).toContain('href="./moura/"');
      expect(landing).toContain('href="./allure/"');
      expect(landing).toContain('href="./coverage/"');
      expect(landing).toContain(
        'href="https://github.com/specxai/moura">specxai/moura</a>',
      );
      expect(landing).toContain("Commit: <code>0123456</code>");
      for (const report of ["moura", "allure", "coverage"])
        await expect(
          readFile(join(directory, "_site", report, "index.html"), "utf8"),
        ).resolves.toBeTruthy();
    } finally {
      await rm(directory, { recursive: true });
    }
  });
});
