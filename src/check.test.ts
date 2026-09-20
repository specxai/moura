import { describe, expect, it as vitestIt } from "vitest";

import { checkVerification } from "./check.js";
import { parseManifest, type MouraManifest } from "./manifest.js";
import type { Evidence } from "./model.js";
import {
  mouraEvidenceName,
  mouraEvidenceTest,
} from "./test-support/moura-evidence.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-002/SCN-001/CASE-005"], "unit");

const caseId = "requirement/scenario/case";

function manifest(verify: readonly string[] = ["unit"]): MouraManifest {
  const parsed = parseManifest(`
version: 1
sources:
  requirements: [req.md]
  specifications: [spec.md]
verification:
  layers: [unit, integration]
requirements:
  - id: requirement
    scenarios:
      - id: scenario
        cases:
          - id: case
            verify: [${verify.join(", ")}]
`);
  expect(parsed.errors).toEqual([]);
  expect(parsed.value).toBeDefined();
  return parsed.value!;
}

function evidence(
  statuses: readonly Evidence["status"][],
  layer = "unit",
  covers: readonly string[] = [caseId],
): Evidence[] {
  return statuses.map((status) => ({ covers, layer, status }));
}

describe("REQ-002 verification check contract", () => {
  const aggregationCases = [
    { name: "an empty set of", statuses: [], expected: "MISSING" },
    { name: "passed", statuses: ["passed"], expected: "PASS" },
    { name: "failed", statuses: ["failed"], expected: "FAIL" },
    { name: "broken", statuses: ["broken"], expected: "BROKEN" },
    { name: "skipped", statuses: ["skipped"], expected: "SKIPPED" },
    {
      name: "broken and passed",
      statuses: ["broken", "passed"],
      expected: "BROKEN",
    },
    {
      name: "broken and skipped",
      statuses: ["broken", "skipped"],
      expected: "BROKEN",
    },
    {
      name: "failed and broken",
      statuses: ["failed", "broken"],
      expected: "FAIL",
    },
    {
      name: "passed and skipped",
      statuses: ["passed", "skipped"],
      expected: "PASS",
    },
    {
      name: "passed and failed",
      statuses: ["passed", "failed"],
      expected: "FAIL",
    },
    {
      name: "skipped and failed",
      statuses: ["skipped", "failed"],
      expected: "FAIL",
    },
    {
      name: "multiple passed",
      statuses: ["passed", "passed"],
      expected: "PASS",
    },
  ] as const;

  for (const testCase of aggregationCases) {
    const name = `aggregates ${testCase.name} evidence as ${testCase.expected}`;
    const cases =
      testCase.name === "an empty set of"
        ? ["REQ-002/SCN-001/CASE-002"]
        : testCase.name === "failed"
          ? ["REQ-002/SCN-001/CASE-003", "REQ-002/SCN-001/CASE-005"]
          : testCase.name === "skipped"
            ? ["REQ-002/SCN-001/CASE-004", "REQ-002/SCN-001/CASE-005"]
            : testCase.name === "broken"
              ? ["REQ-002/SCN-001/CASE-005", "REQ-002/SCN-001/CASE-008"]
              : testCase.name === "passed and skipped"
                ? ["REQ-002/SCN-001/CASE-001", "REQ-002/SCN-001/CASE-005"]
                : testCase.name === "passed"
                  ? ["REQ-002/SCN-001/CASE-001"]
                  : ["REQ-002/SCN-001/CASE-005"];

    it(
      mouraEvidenceName(
        name,
        testCase.expected === "SKIPPED"
          ? [...cases, "REQ-002/SCN-001/CASE-009"]
          : cases,
        "unit",
      ),
      () => {
        const result = checkVerification(
          manifest(),
          evidence(testCase.statuses),
        );
        expect(result.entries[0]?.status).toBe(testCase.expected);
        expect(result.passed).toBe(
          testCase.expected === "PASS" || testCase.expected === "SKIPPED",
        );
      },
    );
  }

  it(
    mouraEvidenceName(
      "aggregates evidence independently of evidence ordering",
      ["REQ-002/SCN-001/CASE-005"],
      "unit",
    ),
    () => {
      for (const [left, right] of [
        ["passed", "failed"],
        ["passed", "skipped"],
        ["skipped", "failed"],
        ["broken", "passed"],
        ["broken", "skipped"],
        ["failed", "broken"],
      ] as const) {
        const forward = checkVerification(manifest(), evidence([left, right]));
        const reverse = checkVerification(manifest(), evidence([right, left]));
        expect(forward).toEqual(reverse);
      }
    },
  );

  it(
    mouraEvidenceName(
      "checks every required Case × layer pair independently",
      ["REQ-002/SCN-001/CASE-005"],
      "unit",
    ),
    () => {
      const missing = checkVerification(
        manifest(["unit", "integration"]),
        evidence(["passed"]),
      );
      expect(missing.entries).toEqual([
        { caseId, layer: "unit", status: "PASS", severity: "success" },
        {
          caseId,
          layer: "integration",
          status: "MISSING",
          severity: "error",
        },
      ]);
      expect(missing.passed).toBe(false);

      const failed = checkVerification(manifest(["unit", "integration"]), [
        ...evidence(["passed"]),
        ...evidence(["failed"], "integration"),
      ]);
      expect(failed.entries).toEqual([
        { caseId, layer: "unit", status: "PASS", severity: "success" },
        {
          caseId,
          layer: "integration",
          status: "FAIL",
          severity: "error",
        },
      ]);
    },
  );

  it(
    mouraEvidenceName(
      "treats an explicit unimplemented declaration as a warning",
      ["REQ-002/SCN-001/CASE-009", "REQ-002/SCN-001/CASE-010"],
      "unit",
    ),
    () => {
      const parsed = parseManifest(`
version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit, integration] }
requirements:
  - id: requirement
    scenarios:
      - id: scenario
        cases:
          - { id: case, verify: [unit], unimplemented: [integration] }
`);
      const result = checkVerification(parsed.value!, evidence(["passed"]));
      expect(result.entries).toEqual([
        { caseId, layer: "unit", status: "PASS", severity: "success" },
        {
          caseId,
          layer: "integration",
          status: "UNIMPLEMENTED",
          severity: "warning",
        },
      ]);
      expect(result.passed).toBe(true);
    },
  );

  it(
    mouraEvidenceName(
      "rejects evidence that contradicts an unimplemented declaration",
      ["REQ-002/SCN-001/CASE-010"],
      "unit",
    ),
    () => {
      const parsed = parseManifest(`
version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit] }
requirements:
  - id: requirement
    scenarios:
      - id: scenario
        cases:
          - { id: case, unimplemented: [unit] }
`);
      const result = checkVerification(parsed.value!, evidence(["passed"]));
      expect(result.entries[0]?.status).toBe("UNIMPLEMENTED");
      expect(result.evidenceIssues[0]?.code).toBe(
        "evidence-for-unimplemented-pair",
      );
      expect(result.passed).toBe(false);
    },
  );

  it(
    mouraEvidenceName(
      "retains manifest Case and verify-layer order",
      ["REQ-002/SCN-001/CASE-005"],
      "unit",
    ),
    () => {
      const parsed = parseManifest(`
version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [integration, unit] }
requirements:
  - id: second
    scenarios:
      - id: behavior
        cases:
          - { id: later, verify: [unit, integration] }
          - { id: last, verify: [integration] }
  - id: first
    scenarios:
      - id: behavior
        cases:
          - { id: earlier, verify: [unit] }
`);
      expect(parsed.value).toBeDefined();
      expect(
        checkVerification(parsed.value!, []).entries.map(
          ({ caseId, layer }) => [caseId, layer],
        ),
      ).toEqual([
        ["second/behavior/later", "unit"],
        ["second/behavior/later", "integration"],
        ["second/behavior/last", "integration"],
        ["first/behavior/earlier", "unit"],
      ]);
    },
  );

  it(
    mouraEvidenceName(
      "reports unknown canonical IDs instead of silently ignoring them",
      ["REQ-002/SCN-001/CASE-006"],
      "unit",
    ),
    () => {
      const result = checkVerification(
        manifest(),
        evidence(["passed"], "unit", ["unknown/scenario/case"]),
      );
      expect(result.evidenceIssues[0]?.code).toBe("unknown-evidence-id");
      expect(result.passed).toBe(false);
    },
  );

  it(
    mouraEvidenceName(
      "reports evidence for undeclared verification layers",
      ["REQ-002/SCN-001/CASE-007"],
      "unit",
    ),
    () => {
      const result = checkVerification(
        manifest(),
        evidence(["passed"], "system"),
      );
      expect(result.evidenceIssues[0]?.code).toBe("unknown-evidence-layer");
      expect(result.passed).toBe(false);
    },
  );

  it(
    mouraEvidenceName(
      "reports evidence for a layer that the covered Case does not require",
      ["REQ-002/SCN-001/CASE-007"],
      "unit",
    ),
    () => {
      const result = checkVerification(
        manifest(["unit"]),
        evidence(["passed"], "integration"),
      );
      expect(result.evidenceIssues[0]?.code).toBe("non-required-evidence-pair");
      expect(result.passed).toBe(false);
    },
  );

  it("distinguishes Case × layer pairs containing delimiter characters", () => {
    const collisionManifest: MouraManifest = {
      version: 1,
      sources: {
        requirements: ["req.md"],
        specifications: ["spec.md"],
      },
      verificationLayers: ["y|z", "z", "other"],
      requirements: [
        {
          kind: "requirement",
          localId: "r",
          scenarios: [
            {
              kind: "scenario",
              localId: "s",
              cases: [
                { kind: "case", localId: "x", verify: ["y|z"] },
                { kind: "case", localId: "x|y", verify: ["other"] },
              ],
            },
          ],
        },
      ],
    };

    const result = checkVerification(collisionManifest, [
      { covers: ["r/s/x|y"], layer: "z", status: "passed" },
    ]);

    expect(
      result.evidenceIssues.some(
        (issue) => issue.code === "non-required-evidence-pair",
      ),
    ).toBeTruthy();
    expect(result.passed).toBe(false);
  });

  it(
    mouraEvidenceName(
      "limits v0.1 evidence targets to canonical Case IDs",
      ["REQ-002/SCN-001/CASE-006"],
      "unit",
    ),
    () => {
      const result = checkVerification(
        manifest(),
        evidence(["passed"], "unit", ["requirement/scenario"]),
      );
      expect(result.evidenceIssues[0]?.code).toBe("non-case-evidence-target");
      expect(result.passed).toBe(false);
    },
  );

  it(
    mouraEvidenceName(
      "reports evidence with no coverage targets",
      ["REQ-002/SCN-001/CASE-006"],
      "unit",
    ),
    () => {
      const result = checkVerification(
        manifest(),
        evidence(["passed"], "unit", []),
      );
      expect(result.evidenceIssues[0]?.code).toBe("empty-evidence-coverage");
      expect(result.passed).toBe(false);
    },
  );

  it("reports evidence issues independently of evidence ordering", () => {
    const unknownId = evidence(["passed"], "unit", ["unknown"])[0]!;
    const unknownLayer = evidence(["passed"], "system")[0]!;
    expect(checkVerification(manifest(), [unknownId, unknownLayer])).toEqual(
      checkVerification(manifest(), [unknownLayer, unknownId]),
    );
  });
});
