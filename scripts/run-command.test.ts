import process from "node:process";

import { describe, expect, it as vitestIt, vi } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";

import { runCommand } from "./run-command.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-005/SCN-002/CASE-004"], "unit");

describe("runCommand", () => {
  it("returns captured stdout and stderr on success", () => {
    const spawn = vi.fn(() => ({
      status: 0,
      stdout: "standard output",
      stderr: "standard error",
    }));

    expect(
      runCommand("tool", ["argument"], {
        cwd: "/project",
        spawn,
      }),
    ).toEqual({ stdout: "standard output", stderr: "standard error" });
    expect(spawn).toHaveBeenCalledWith("tool", ["argument"], {
      cwd: "/project",
      encoding: "utf8",
    });
  });

  it("preserves arguments containing spaces", () => {
    const result = runCommand(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1])",
      "argument containing spaces",
    ]);

    expect(result).toEqual({
      stdout: "argument containing spaces",
      stderr: "",
    });
  });

  it("includes status, stdout, and stderr when a command fails", () => {
    const spawn = vi.fn(() => ({
      status: 2,
      stdout: "partial output",
      stderr: "failure detail",
    }));

    expect(() => runCommand("tool", [], { spawn })).toThrow(
      /status 2\npartial outputfailure detail/u,
    );
  });

  it("reports a spawn failure with its cause", () => {
    const cause = new Error("not found");
    const spawn = vi.fn(() => ({
      status: null,
      stdout: "",
      stderr: "",
      error: cause,
    }));

    expect(() => runCommand("missing", [], { spawn })).toThrow(
      /Could not run missing: not found/u,
    );
  });
});
