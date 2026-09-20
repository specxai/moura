import { resolve } from "node:path";

import {
  loadAllureResultsDirectory,
  type EvidenceAdapterResult,
  type UnmappedResult,
} from "./adapters/allure.js";
import { checkVerification } from "./check.js";
import type { EvidenceIssue, VerificationProjectCheckResult } from "./check.js";
import type { MouraManifest } from "./manifest.js";
import { loadProjectDirectory } from "./project.js";

export interface CheckCommandOutput {
  readonly exitCode: 0 | 1;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
}

export interface CheckCommandDependencies {
  readonly loadEvidence?: (directory: string) => Promise<EvidenceAdapterResult>;
}

export interface CheckCommandOptions extends CheckCommandDependencies {
  readonly strictTraceability?: boolean;
}

export interface TraceabilityDiagnostic extends UnmappedResult {
  readonly code: "UNMAPPED";
  readonly severity: "warning" | "error";
  readonly message: string;
}

export function formatEvidenceAdapterIssue(
  issue: EvidenceAdapterResult["issues"][number],
): string {
  const source = issue.source === undefined ? "" : `${issue.source}: `;
  return `${issue.code}: ${source}${issue.message}`;
}

export function formatEvidenceIssue(issue: EvidenceIssue): string {
  const target = issue.canonicalId ?? "(no Case ID)";
  return `${issue.code}: ${target} [${issue.layer}]: ${issue.message}`;
}

export function formatTraceabilityDiagnostic(
  diagnostic: TraceabilityDiagnostic,
): string {
  const location = diagnostic.source
    ? `${diagnostic.name} (${diagnostic.source})`
    : diagnostic.name;
  return `${diagnostic.severity.toUpperCase()} ${diagnostic.code} ${location}: ${diagnostic.message}`;
}

export type ProjectCheckEvaluation =
  | {
      readonly kind: "invalid-project";
      readonly errors: readonly string[];
    }
  | {
      readonly kind: "checked";
      readonly manifest: MouraManifest;
      readonly check: VerificationProjectCheckResult;
      readonly adapterIssues: EvidenceAdapterResult["issues"];
      readonly traceabilityDiagnostics: readonly TraceabilityDiagnostic[];
    };

/** Shared filesystem evaluation used by both human CLI and artifact renderers. */
export async function evaluateProjectDirectory(
  directory: string,
  options: CheckCommandOptions = {},
): Promise<ProjectCheckEvaluation> {
  const project = await loadProjectDirectory(directory);
  if (!project.manifest)
    return {
      kind: "invalid-project",
      errors: project.errors.map((problem) => problem.message),
    };

  const loadEvidence = options.loadEvidence ?? loadAllureResultsDirectory;
  const adapted = await loadEvidence(resolve(directory, "allure-results"));
  const traceabilityDiagnostics = (adapted.unmapped ?? []).map((result) => ({
    ...result,
    code: "UNMAPPED" as const,
    severity: options.strictTraceability
      ? ("error" as const)
      : ("warning" as const),
    message: "No Moura Case is associated with this test result.",
  }));
  return {
    kind: "checked",
    manifest: project.manifest,
    check: checkVerification(project.manifest, adapted.evidence),
    adapterIssues: adapted.issues,
    traceabilityDiagnostics,
  };
}

/** Filesystem command boundary; the check core remains adapter-neutral and pure. */
export async function checkProjectDirectory(
  directory: string,
  options: CheckCommandOptions = {},
): Promise<CheckCommandOutput> {
  const evaluation = await evaluateProjectDirectory(directory, options);
  if (evaluation.kind === "invalid-project") {
    return {
      exitCode: 1,
      stdout: [],
      stderr: [
        "✗ Traceability validation failed",
        ...evaluation.errors.map((message) => `- ${message}`),
      ],
    };
  }

  const adapted = { issues: evaluation.adapterIssues };
  const checked = evaluation.check;
  const stdout = checked.entries.map(
    (entry) =>
      `${entry.status} ${entry.caseId} [${entry.layer}] (${entry.severity})`,
  );
  const stderr: string[] = [];
  for (const diagnostic of evaluation.traceabilityDiagnostics)
    stderr.push(formatTraceabilityDiagnostic(diagnostic));
  if (adapted.issues.length > 0) {
    stderr.push("✗ Evidence adapter issues");
    for (const issue of adapted.issues) {
      stderr.push(`- ${formatEvidenceAdapterIssue(issue)}`);
    }
  }
  if (checked.evidenceIssues.length > 0) {
    stderr.push("✗ Semantic evidence issues");
    for (const issue of checked.evidenceIssues) {
      stderr.push(`- ${formatEvidenceIssue(issue)}`);
    }
  }

  return {
    exitCode:
      adapted.issues.length === 0 &&
      checked.passed &&
      evaluation.traceabilityDiagnostics.every(
        (diagnostic) => diagnostic.severity !== "error",
      )
        ? 0
        : 1,
    stdout,
    stderr,
  };
}
