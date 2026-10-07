import { canonicalId } from "./id.js";
import type { MouraManifest } from "./manifest.js";
import type {
  VerificationCheckResult,
  VerificationCheckStatus,
  VerificationProjectCheckResult,
} from "./check.js";

export interface CoverageCount {
  readonly covered: number;
  readonly total: number;
}

export interface CoverageSummary {
  readonly requirements: CoverageCount;
  readonly scenarios: CoverageCount;
  readonly cases: CoverageCount;
  readonly pairs: CoverageCount;
  readonly layers: readonly (CoverageCount & { readonly layer: string })[];
}

/** Roll up authoritative pair statuses; only PASS is coverage. */
export function summarizeCoverage(
  manifest: MouraManifest,
  check: VerificationProjectCheckResult,
): CoverageSummary {
  const hierarchy = aggregateCoverageHierarchy(manifest, check);
  const nodes = [...hierarchy.values()];
  const countKind = (kind: CoverageNodeStatus["kind"]): CoverageCount => ({
    covered: nodes.filter(
      (node) => node.kind === kind && node.status === "PASS",
    ).length,
    total: nodes.filter((node) => node.kind === kind).length,
  });

  return {
    requirements: countKind("requirement"),
    scenarios: countKind("scenario"),
    cases: countKind("case"),
    pairs: {
      covered: check.entries.filter((entry) => entry.status === "PASS").length,
      total: check.entries.length,
    },
    layers: manifest.verificationLayers.map((layer) => {
      const entries = check.entries.filter((entry) => entry.layer === layer);
      return {
        layer,
        covered: entries.filter((entry) => entry.status === "PASS").length,
        total: entries.length,
      };
    }),
  };
}

export const coverageStatuses: readonly VerificationCheckStatus[] = [
  "PASS",
  "FAIL",
  "BROKEN",
  "SKIPPED",
  "UNIMPLEMENTED",
  "MISSING",
];

export interface CoverageNodeStatus {
  readonly kind: "requirement" | "scenario" | "case";
  readonly status: "PASS" | "INCOMPLETE" | "FAIL";
  readonly severity: "success" | "warning" | "error";
}

/** The summary and map share this roll-up of authoritative Check pair severity.
 * MISSING remains error; SKIPPED and UNIMPLEMENTED remain warning.
 * Exact pair statuses are retained by Check, rather than replaced by this roll-up.
 */
export function aggregateCoverageHierarchy(
  manifest: MouraManifest,
  check: VerificationProjectCheckResult,
): ReadonlyMap<string, CoverageNodeStatus> {
  const nodes = new Map<string, CoverageNodeStatus>();
  const byCase = new Map<string, VerificationCheckResult[]>();
  for (const entry of check.entries)
    byCase.set(entry.caseId, [...(byCase.get(entry.caseId) ?? []), entry]);
  const rollUp = (
    kind: CoverageNodeStatus["kind"],
    children: readonly { readonly severity: CoverageNodeStatus["severity"] }[],
  ): CoverageNodeStatus => {
    const severity =
      children.length === 0 ||
      children.some((child) => child.severity === "error")
        ? "error"
        : children.some((child) => child.severity === "warning")
          ? "warning"
          : "success";
    return {
      kind,
      severity,
      status:
        severity === "success"
          ? "PASS"
          : severity === "warning"
            ? "INCOMPLETE"
            : "FAIL",
    };
  };
  for (const requirement of manifest.requirements) {
    const scenarios: CoverageNodeStatus[] = [];
    for (const scenario of requirement.scenarios) {
      const cases: CoverageNodeStatus[] = [];
      for (const testCase of scenario.cases) {
        const id = canonicalId([requirement, scenario, testCase]);
        const entries = byCase.get(id) ?? [];
        for (const layer of [
          ...testCase.verify,
          ...(testCase.unimplemented ?? []),
        ])
          if (!entries.some((entry) => entry.layer === layer))
            throw new Error(
              `Check result omitted required pair ${id} × ${layer}`,
            );
        const node = rollUp("case", entries);
        nodes.set(id, node);
        cases.push(node);
      }
      const node = rollUp("scenario", cases);
      nodes.set(canonicalId([requirement, scenario]), node);
      scenarios.push(node);
    }
    nodes.set(canonicalId([requirement]), rollUp("requirement", scenarios));
  }
  return nodes;
}
