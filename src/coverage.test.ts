import { describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "./test-support/moura-evidence.js";

import { checkVerification } from "./check.js";
import { summarizeCoverage } from "./coverage.js";
import { parseManifest } from "./manifest.js";
import type { Evidence } from "./model.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-003/SCN-002/CASE-002"], "unit");

const manifest = parseManifest(`
version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit, integration] }
requirements:
  - id: R1
    scenarios:
      - id: S1
        cases:
          - { id: C1, verify: [unit, integration] }
          - { id: C2, verify: [unit] }
  - id: R2
    scenarios:
      - id: S2
        cases:
          - { id: C3, verify: [integration] }
`).value!;

describe("requirement coverage roll-up", () => {
  it("covers ancestors only when every descendant required pair is PASS", () => {
    const evidence: Evidence[] = [
      { covers: ["R1/S1/C1"], layer: "unit", status: "passed" },
      { covers: ["R1/S1/C1"], layer: "integration", status: "skipped" },
      { covers: ["R1/S1/C2"], layer: "unit", status: "passed" },
      { covers: ["R2/S2/C3"], layer: "integration", status: "passed" },
    ];
    const summary = summarizeCoverage(
      manifest,
      checkVerification(manifest, evidence),
    );
    expect(summary).toEqual({
      requirements: { covered: 1, total: 2 },
      scenarios: { covered: 1, total: 2 },
      cases: { covered: 2, total: 3 },
      pairs: { covered: 3, total: 4 },
      layers: [
        { layer: "unit", covered: 2, total: 2 },
        { layer: "integration", covered: 1, total: 2 },
      ],
    });
  });
});
