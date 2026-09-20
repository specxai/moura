import { describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";

import {
  type AllureLabel,
  validateCompleteMouraDogfoodResults,
  validateMouraEvidenceResults,
} from "./verify-allure-results.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-005/SCN-001/CASE-002"], "unit");

const caseLayers = new Map([
  ["REQ-001/SCN-001/CASE-001", new Set(["unit", "integration"])],
  ["REQ-001/SCN-001/CASE-002", new Set(["unit"])],
  ["REQ-001/SCN-001/CASE-003", new Set(["integration"])],
]);
const knownLayers = new Set(["unit", "integration"]);

function result(...labels: AllureLabel[]) {
  return { name: "evidence result", status: "passed", labels };
}

function hierarchyLabels(caseId: string): AllureLabel[] {
  const [requirement, scenario, testCase] = caseId.split("/");
  return [
    { name: "moura_requirement", value: requirement! },
    { name: "moura_scenario", value: scenario! },
    { name: "moura_case", value: testCase! },
  ];
}

describe("Allure Moura evidence metadata verification", () => {
  it("accepts ordinary results without Moura labels", () => {
    expect(() =>
      validateMouraEvidenceResults([result()], caseLayers, knownLayers),
    ).not.toThrow();
  });

  it.each([
    ["one Case", ["REQ-001/SCN-001/CASE-002"]],
    [
      "multiple Cases requiring the layer",
      ["REQ-001/SCN-001/CASE-001", "REQ-001/SCN-001/CASE-002"],
    ],
  ])("accepts %s", (_name, cases) => {
    expect(() =>
      validateMouraEvidenceResults(
        [
          result(...cases.flatMap(hierarchyLabels), {
            name: "moura_layer",
            value: "unit",
          }),
        ],
        caseLayers,
        knownLayers,
      ),
    ).not.toThrow();
  });

  it.each([
    {
      name: "missing moura_case",
      labels: [{ name: "moura_layer", value: "unit" }],
      message: "no valid moura_requirement",
    },
    {
      name: "missing moura_layer",
      labels: hierarchyLabels("REQ-001/SCN-001/CASE-001"),
      message: "no valid moura_layer",
    },
    {
      name: "duplicate moura_layer",
      labels: [
        ...hierarchyLabels("REQ-001/SCN-001/CASE-001"),
        { name: "moura_layer", value: "unit" },
        { name: "moura_layer", value: "unit" },
      ],
      message: "exactly one moura_layer",
    },
    {
      name: "unknown Case",
      labels: [
        ...hierarchyLabels("REQ-999/SCN-999/CASE-999"),
        { name: "moura_layer", value: "unit" },
      ],
      message: "unknown Moura Case",
    },
    {
      name: "unknown layer",
      labels: [
        ...hierarchyLabels("REQ-001/SCN-001/CASE-001"),
        { name: "moura_layer", value: "system" },
      ],
      message: "unknown Moura verification layer",
    },
    {
      name: "non-required Case and layer pair",
      labels: [
        ...hierarchyLabels("REQ-001/SCN-001/CASE-003"),
        { name: "moura_layer", value: "unit" },
      ],
      message:
        "non-required Moura verification pair REQ-001/SCN-001/CASE-003 × unit",
    },
    {
      name: "multiple Cases where one does not require the layer",
      labels: [
        ...hierarchyLabels("REQ-001/SCN-001/CASE-001"),
        ...hierarchyLabels("REQ-001/SCN-001/CASE-003"),
        { name: "moura_layer", value: "unit" },
      ],
      message:
        "non-required Moura verification pair REQ-001/SCN-001/CASE-003 × unit",
    },
  ])("rejects $name", ({ labels, message }) => {
    expect(() =>
      validateMouraEvidenceResults(
        [result(...labels)],
        caseLayers,
        knownLayers,
      ),
    ).toThrow(message);
  });
});

describe("complete Moura dogfooding metadata verification", () => {
  it("accepts a result with a complete authoritative mapping", () => {
    expect(() =>
      validateCompleteMouraDogfoodResults([
        result(...hierarchyLabels("REQ-001/SCN-001/CASE-001"), {
          name: "moura_layer",
          value: "unit",
        }),
      ]),
    ).not.toThrow();
  });

  it("rejects an unmapped result in Moura's dedicated run", () => {
    expect(() => validateCompleteMouraDogfoodResults([result()])).toThrow(
      '"evidence result" has no Moura Evidence metadata',
    );
  });
});
