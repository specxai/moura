import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Evidence } from "../model.js";
import {
  canonicalCaseIdError,
  interoperableStringError,
  localId,
} from "../id.js";

/** The small, Moura-owned subset of an Allure result used during conversion. */
export interface AllureEvidenceResult {
  readonly name?: unknown;
  readonly labels?: readonly AllureEvidenceLabel[];
  readonly status?: unknown;
}

export interface AllureEvidenceLabel {
  readonly name?: unknown;
  readonly value?: unknown;
}

export type EvidenceAdapterIssueCode =
  | "invalid-result"
  | "invalid-label"
  | "invalid-moura-requirement-label"
  | "invalid-moura-scenario-label"
  | "invalid-moura-case-label"
  | "invalid-moura-layer-label"
  | "missing-moura-requirement"
  | "missing-moura-scenario"
  | "missing-moura-case"
  | "ambiguous-moura-hierarchy"
  | "missing-moura-layer"
  | "multiple-moura-layers"
  | "missing-status"
  | "malformed-status"
  | "unknown-status"
  | "unsupported-status"
  | "malformed-json"
  | "unreadable-results-directory"
  | "unreadable-result-file";

export interface EvidenceAdapterIssue {
  readonly code: EvidenceAdapterIssueCode;
  readonly message: string;
  readonly source?: string;
}

export interface EvidenceAdapterResult {
  readonly evidence: readonly Evidence[];
  readonly issues: readonly EvidenceAdapterIssue[];
  readonly unmapped?: readonly UnmappedResult[];
}

/** An explicitly Moura-managed Allure result without authoritative mapping. */
export interface UnmappedResult {
  readonly name: string;
  readonly source?: string;
}

const supportedStatuses = new Set<Evidence["status"]>([
  "passed",
  "failed",
  "broken",
  "skipped",
]);

/** Convert one parsed Allure result. Only explicitly managed unlabeled results are unmapped. */
export function convertAllureResult(
  input: unknown,
  source?: string,
): EvidenceAdapterResult {
  if (!isRecord(input))
    return adapterFailure(
      "invalid-result",
      "Allure result must be a JSON object",
      source,
    );

  const labels = Array.isArray(input.labels) ? input.labels : [];
  const mouraLabels = labels.filter(
    (label) =>
      isRecord(label) &&
      (label.name === "moura_requirement" ||
        label.name === "moura_scenario" ||
        label.name === "moura_case" ||
        label.name === "moura_layer"),
  );
  if (mouraLabels.length === 0) {
    const managed = labels.some(
      (label) =>
        isRecord(label) &&
        label.name === "moura_traceability" &&
        label.value === "managed",
    );
    if (!managed) return { evidence: [], issues: [] };
    const name =
      typeof input.name === "string" && input.name.length > 0
        ? input.name
        : "Unnamed Allure result";
    return {
      evidence: [],
      issues: [],
      unmapped: [{ name, ...(source === undefined ? {} : { source }) }],
    };
  }

  const issues: EvidenceAdapterIssue[] = [];
  const requirementValues: string[] = [];
  const scenarioValues: string[] = [];
  const caseValues: string[] = [];
  const layerValues: string[] = [];
  for (const label of mouraLabels) {
    if (typeof label.value !== "string" || label.value.length === 0) {
      issues.push(
        issue(
          "invalid-label",
          `${String(label.name)} must have a non-empty string value`,
          source,
        ),
      );
    } else if (label.name !== "moura_layer") {
      try {
        localId(label.value);
      } catch {
        const kind = String(label.name).replace("moura_", "");
        issues.push(
          issue(
            `invalid-moura-${kind}-label` as EvidenceAdapterIssueCode,
            `${String(label.name)} contains characters or structure not allowed in a local Moura ID`,
            source,
          ),
        );
        continue;
      }
      if (label.name === "moura_requirement")
        requirementValues.push(label.value);
      else if (label.name === "moura_scenario")
        scenarioValues.push(label.value);
      else caseValues.push(label.value);
    } else if (interoperableStringError(label.value)) {
      issues.push(
        issue(
          "invalid-moura-layer-label",
          "moura_layer contains characters not allowed in a Moura verification-layer name",
          source,
        ),
      );
    } else layerValues.push(label.value);
  }

  if (requirementValues.length === 0)
    issues.push(
      issue(
        "missing-moura-requirement",
        "Result has no valid moura_requirement label",
        source,
      ),
    );
  if (scenarioValues.length === 0)
    issues.push(
      issue(
        "missing-moura-scenario",
        "Result has no valid moura_scenario label",
        source,
      ),
    );
  if (caseValues.length === 0)
    issues.push(
      issue(
        "missing-moura-case",
        "Result has no valid moura_case label",
        source,
      ),
    );
  if (
    requirementValues.length > 0 &&
    scenarioValues.length > 0 &&
    caseValues.length > 0 &&
    (requirementValues.length !== scenarioValues.length ||
      scenarioValues.length !== caseValues.length)
  )
    issues.push(
      issue(
        "ambiguous-moura-hierarchy",
        "Result must have equally many ordered moura_requirement, moura_scenario, and moura_case labels",
        source,
      ),
    );
  if (layerValues.length === 0)
    issues.push(
      issue(
        "missing-moura-layer",
        "Result has no valid moura_layer label",
        source,
      ),
    );
  else if (layerValues.length > 1)
    issues.push(
      issue(
        "multiple-moura-layers",
        "Result must have exactly one moura_layer label",
        source,
      ),
    );

  const status = input.status;
  if (status === undefined)
    issues.push(issue("missing-status", "Result has no status", source));
  else if (typeof status !== "string")
    issues.push(
      issue("malformed-status", "Result status must be a string", source),
    );
  else if (status === "unknown")
    issues.push(
      issue(
        "unknown-status",
        "Allure status unknown is invalid evidence",
        source,
      ),
    );
  else if (!supportedStatuses.has(status as Evidence["status"]))
    issues.push(
      issue(
        "unsupported-status",
        `Unsupported Allure status ${JSON.stringify(status)}`,
        source,
      ),
    );

  if (issues.length > 0) return { evidence: [], issues };
  const canonicalCases = caseValues.map(
    (testCase, index) =>
      `${requirementValues[index]}/${scenarioValues[index]}/${testCase}`,
  );
  if (canonicalCases.some((caseId) => canonicalCaseIdError(caseId)))
    return adapterFailure(
      "ambiguous-moura-hierarchy",
      "Result hierarchy labels do not form valid canonical Moura Case IDs",
      source,
    );
  const evidence: Evidence = {
    covers: [...new Set(canonicalCases)],
    layer: layerValues[0]!,
    status: status as Evidence["status"],
    ...(source === undefined ? {} : { source }),
  };
  return { evidence: [evidence], issues: [] };
}

/** Load only sorted `*-result.json` files from an Allure results directory. */
export async function loadAllureResultsDirectory(
  directory: string,
): Promise<EvidenceAdapterResult> {
  const evidence: Evidence[] = [];
  const issues: EvidenceAdapterIssue[] = [];
  const unmapped: UnmappedResult[] = [];
  let files: string[];
  try {
    files = (await readdir(directory))
      .filter((file) => file.endsWith("-result.json"))
      .sort(compareStrings);
  } catch (error) {
    return adapterFailure(
      "unreadable-results-directory",
      `Could not read Allure results directory: ${errorMessage(error)}`,
      directory,
    );
  }

  for (const source of files) {
    let contents: string;
    try {
      contents = await readFile(join(directory, source), "utf8");
    } catch (error) {
      issues.push(
        issue(
          "unreadable-result-file",
          `Could not read Allure result: ${errorMessage(error)}`,
          source,
        ),
      );
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (error) {
      issues.push(
        issue(
          "malformed-json",
          `Could not parse Allure result JSON: ${errorMessage(error)}`,
          source,
        ),
      );
      continue;
    }
    const converted = convertAllureResult(parsed, source);
    evidence.push(...converted.evidence);
    issues.push(...converted.issues);
    unmapped.push(...(converted.unmapped ?? []));
  }
  return { evidence, issues, unmapped };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(
  code: EvidenceAdapterIssueCode,
  message: string,
  source?: string,
): EvidenceAdapterIssue {
  return { code, message, ...(source === undefined ? {} : { source }) };
}

function adapterFailure(
  code: EvidenceAdapterIssueCode,
  message: string,
  source?: string,
): EvidenceAdapterResult {
  return { evidence: [], issues: [issue(code, message, source)] };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
