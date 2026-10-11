export interface CoverageMetric {
  readonly pct: number;
}

export interface CoverageSummary {
  readonly statements: CoverageMetric;
  readonly branches: CoverageMetric;
  readonly functions: CoverageMetric;
  readonly lines: CoverageMetric;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCoverageMetric(value: unknown): value is CoverageMetric {
  return isRecord(value) && typeof value.pct === "number";
}

export function parseCoverageSummary(value: unknown): CoverageSummary {
  if (!isRecord(value) || !("total" in value))
    throw new Error("coverage summary does not contain total metrics");
  const total = value.total;
  const names = ["statements", "branches", "functions", "lines"] as const;
  if (!isRecord(total) || !names.every((name) => isCoverageMetric(total[name])))
    throw new Error("coverage summary has invalid total metrics");
  const { statements, branches, functions, lines } = total;
  if (
    !isCoverageMetric(statements) ||
    !isCoverageMetric(branches) ||
    !isCoverageMetric(functions) ||
    !isCoverageMetric(lines)
  )
    throw new Error("coverage summary has invalid total metrics");
  return { statements, branches, functions, lines };
}
