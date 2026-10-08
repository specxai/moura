import type { CanonicalId } from "./id.js";

/** The stable domain roles in Moura's traceability hierarchy. */
export type NodeKind = "requirement" | "scenario" | "case";

/** A configurable verification dimension, deliberately not a closed enum. */
export type VerificationLayer = string;

export interface TraceNode {
  readonly kind: NodeKind;
  readonly localId: string;
}

export interface CaseNode extends TraceNode {
  readonly kind: "case";
  /** Layers for which runtime Evidence is required. */
  readonly verify: readonly VerificationLayer[];
  /** Explicit, Git-reviewed declarations for verification not yet implemented. */
  readonly unimplemented?: readonly VerificationLayer[];
}

export interface ScenarioNode extends TraceNode {
  readonly kind: "scenario";
  readonly cases: readonly CaseNode[];
}

export interface RequirementNode extends TraceNode {
  readonly kind: "requirement";
  readonly scenarios: readonly ScenarioNode[];
}

/** The smallest unit for which verification coverage is evaluated. */
export interface CoveragePoint {
  readonly canonicalCaseId: CanonicalId;
  readonly layer: VerificationLayer;
}

/** Adapter-neutral evidence. A single result may cover several cases. */
export interface Evidence {
  readonly covers: readonly CanonicalId[];
  readonly layer: VerificationLayer;
  readonly status: "passed" | "failed" | "broken" | "skipped";
  readonly source?: string;
  /** Optional presentation metadata; never used for matching or status. */
  readonly name?: string;
}
