import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { evaluateProjectDirectory } from "../src/check-command.js";
import { summarizeCoverage, type CoverageCount } from "../src/coverage.js";
import type { VerificationProjectCheckResult } from "../src/check.js";

import { readAllureCounts, type AllureCounts } from "./ci-summary.js";
import { parseCoverageSummary } from "./coverage-summary.js";

export type OverallStatus = "PASS" | "INCOMPLETE" | "FAIL";

export interface QualityOverview {
  readonly status: OverallStatus;
  readonly requirementCoverage?: CoverageCount;
  readonly missingEvidence?: number;
  readonly testResults?: AllureCounts;
  readonly codeCoverageLines?: number;
}

/** Use Moura's authoritative pair states: failed Evidence outranks incomplete coverage. */
export function overallStatus(
  check: VerificationProjectCheckResult,
  hasEvaluationProblems = false,
): OverallStatus {
  if (
    check.entries.some(
      (entry) => entry.status === "FAIL" || entry.status === "BROKEN",
    )
  )
    return "FAIL";
  return hasEvaluationProblems ||
    check.entries.some((entry) => entry.status !== "PASS")
    ? "INCOMPLETE"
    : "PASS";
}

/** Missing runtime Evidence includes explicit not-yet-implemented required pairs. */
export function countMissingEvidence(
  check: VerificationProjectCheckResult,
): number {
  return check.entries.filter(
    (entry) => entry.status === "MISSING" || entry.status === "UNIMPLEMENTED",
  ).length;
}

export async function collectQualityOverview(
  root: string,
): Promise<QualityOverview> {
  const evaluation = await evaluateProjectDirectory(root, {
    strictTraceability: true,
  });
  let status: OverallStatus = "INCOMPLETE";
  let requirementCoverage: CoverageCount | undefined;
  let missingEvidence: number | undefined;
  if (evaluation.kind === "checked") {
    const hasEvaluationProblems =
      evaluation.adapterIssues.length > 0 ||
      evaluation.check.evidenceIssues.length > 0 ||
      evaluation.traceabilityDiagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      );
    status = overallStatus(evaluation.check, hasEvaluationProblems);
    requirementCoverage = summarizeCoverage(
      evaluation.manifest,
      evaluation.check,
    ).requirements;
    missingEvidence = countMissingEvidence(evaluation.check);
  }

  const testResults = await optional(async () =>
    readAllureCounts(resolve(root, "allure-results")),
  );
  const coverage = await optional(async () =>
    parseCoverageSummary(
      JSON.parse(
        await readFile(resolve(root, "coverage/coverage-summary.json"), "utf8"),
      ) as unknown,
    ),
  );
  return {
    status,
    ...(requirementCoverage ? { requirementCoverage } : {}),
    ...(missingEvidence === undefined ? {} : { missingEvidence }),
    ...(testResults ? { testResults } : {}),
    ...(coverage ? { codeCoverageLines: coverage.lines.pct } : {}),
  };
}

async function optional<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}
