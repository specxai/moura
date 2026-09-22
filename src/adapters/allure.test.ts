import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it as vitestIt } from "vitest";

import {
  mouraEvidenceName,
  mouraEvidenceTest,
} from "../test-support/moura-evidence.js";

import { convertAllureResult, loadAllureResultsDirectory } from "./allure.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-004/SCN-001/CASE-001"], "unit");

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

function result(status: unknown = "passed", labels: readonly unknown[] = []) {
  return { status, labels };
}

function hierarchyLabels(caseId = "REQ-001/SCN-001/CASE-001") {
  const [requirement, scenario, testCase] = caseId.split("/");
  return [
    { name: "moura_requirement", value: requirement },
    { name: "moura_scenario", value: scenario },
    { name: "moura_case", value: testCase },
  ];
}
const layerLabel = { name: "moura_layer", value: "unit" };

describe("Allure evidence conversion", () => {
  it.each(["passed", "failed", "broken", "skipped"] as const)(
    "maps %s without an Allure runtime dependency",
    (status) => {
      expect(
        convertAllureResult(
          result(status, [...hierarchyLabels(), layerLabel]),
          "one.json",
        ),
      ).toEqual({
        evidence: [
          {
            covers: ["REQ-001/SCN-001/CASE-001"],
            layer: "unit",
            status,
            source: "one.json",
          },
        ],
        issues: [],
      });
    },
  );

  it.each([
    [
      "unknown status",
      result("unknown", [...hierarchyLabels(), layerLabel]),
      "unknown-status",
    ],
    [
      "missing status",
      { labels: [...hierarchyLabels(), layerLabel] },
      "missing-status",
    ],
    [
      "unsupported status",
      result("pending", [...hierarchyLabels(), layerLabel]),
      "unsupported-status",
    ],
    [
      "non-string status",
      result(42, [...hierarchyLabels(), layerLabel]),
      "malformed-status",
    ],
  ])("reports %s as an adapter issue", (_name, input, code) => {
    const converted = convertAllureResult(input, "bad.json");
    expect(converted.evidence).toEqual([]);
    expect(converted.issues).toContainEqual(
      expect.objectContaining({ code, source: "bad.json" }),
    );
  });

  it("collects multiple Cases and de-duplicates them in first-seen order", () => {
    const converted = convertAllureResult(
      result("passed", [
        ...hierarchyLabels(),
        ...hierarchyLabels("REQ-001/SCN-001/CASE-002"),
        ...hierarchyLabels(),
        layerLabel,
      ]),
    );
    expect(converted.evidence[0]?.covers).toEqual([
      "REQ-001/SCN-001/CASE-001",
      "REQ-001/SCN-001/CASE-002",
    ]);
  });

  it("reconstructs Cases across different Scenarios and Requirements positionally", () => {
    const converted = convertAllureResult(
      result("passed", [
        ...hierarchyLabels("REQ-001/SCN-001/CASE-001"),
        ...hierarchyLabels("REQ-001/SCN-002/CASE-001"),
        ...hierarchyLabels("REQ-002/SCN-001/CASE-001"),
        layerLabel,
      ]),
    );
    expect(converted.evidence[0]?.covers).toEqual([
      "REQ-001/SCN-001/CASE-001",
      "REQ-001/SCN-002/CASE-001",
      "REQ-002/SCN-001/CASE-001",
    ]);
  });

  it("rejects unequal hierarchy sequences as ambiguous", () => {
    const converted = convertAllureResult(
      result("passed", [
        ...hierarchyLabels(),
        { name: "moura_case", value: "CASE-002" },
        layerLabel,
      ]),
    );
    expect(converted.evidence).toEqual([]);
    expect(converted.issues).toContainEqual(
      expect.objectContaining({ code: "ambiguous-moura-hierarchy" }),
    );
  });

  it.each([
    ["NUL", "REQ-001/SCN-001/CASE\u0000-001"],
    ["C0 control", "REQ-001/SCN-001/CASE\u0001-001"],
    ["DEL", "REQ-001/SCN-001/CASE\u007f-001"],
    ["lone surrogate", "REQ-001/SCN-001/CASE\ud800-001"],
    ["malformed canonical ID", "REQ-001/CASE-001"],
  ])("rejects a moura_case containing %s", (_name, value) => {
    const converted = convertAllureResult(
      result("passed", [
        ...hierarchyLabels().slice(0, 2),
        { name: "moura_case", value },
        layerLabel,
      ]),
      "unsafe-result.json",
    );
    expect(converted.evidence).toEqual([]);
    expect(converted.issues).toContainEqual({
      code: "invalid-moura-case-label",
      message:
        "moura_case contains characters or structure not allowed in a local Moura ID",
      source: "unsafe-result.json",
    });
  });

  it.each([
    ["NUL", "unit\u0000bad"],
    ["C0 control", "unit\u0001bad"],
    ["DEL", "unit\u007fbad"],
    ["C1 control", "unit\u009fbad"],
    ["lone surrogate", "unit\udfffbad"],
  ])("rejects a moura_layer containing %s", (_name, value) => {
    const converted = convertAllureResult(
      result("passed", [...hierarchyLabels(), { name: "moura_layer", value }]),
      "unsafe-result.json",
    );
    expect(converted.evidence).toEqual([]);
    expect(converted.issues).toContainEqual({
      code: "invalid-moura-layer-label",
      message:
        "moura_layer contains characters not allowed in a Moura verification-layer name",
      source: "unsafe-result.json",
    });
  });

  it("accepts canonical separators and printable Unicode identities", () => {
    expect(
      convertAllureResult(
        result("passed", [
          ...hierarchyLabels("要件-一/場面-😀/事例-𠮷"),
          { name: "moura_layer", value: "層-🚀" },
        ]),
      ).evidence,
    ).toEqual([
      {
        covers: ["要件-一/場面-😀/事例-𠮷"],
        layer: "層-🚀",
        status: "passed",
      },
    ]);
  });

  it.each([
    ["missing Case", [layerLabel], "missing-moura-case"],
    [
      "missing Requirement",
      [...hierarchyLabels().slice(1), layerLabel],
      "missing-moura-requirement",
    ],
    [
      "missing Scenario",
      [hierarchyLabels()[0], hierarchyLabels()[2], layerLabel],
      "missing-moura-scenario",
    ],
    ["missing layer", [...hierarchyLabels()], "missing-moura-layer"],
    [
      "multiple layers",
      [
        ...hierarchyLabels(),
        layerLabel,
        { name: "moura_layer", value: "integration" },
      ],
      "multiple-moura-layers",
    ],
  ])("reports %s metadata", (_name, labels, code) => {
    const converted = convertAllureResult(result("passed", labels));
    expect(converted.evidence).toEqual([]);
    expect(converted.issues).toContainEqual(expect.objectContaining({ code }));
  });

  it("ignores results with no Moura labels", () => {
    expect(
      convertAllureResult(
        result("unknown", [{ name: "suite", value: "unrelated" }]),
        "unrelated.json",
      ),
    ).toEqual({ evidence: [], issues: [] });
  });

  it("classifies explicitly managed results without authoritative labels as unmapped", () => {
    expect(
      convertAllureResult(
        {
          name: "behavior labels are presentation only",
          status: "passed",
          labels: [
            { name: "moura_traceability", value: "managed" },
            { name: "epic", value: "REQ-001" },
            { name: "feature", value: "SCN-001" },
            { name: "story", value: "CASE-001" },
          ],
        },
        "managed-result.json",
      ),
    ).toEqual({
      evidence: [],
      issues: [],
      unmapped: [
        {
          name: "behavior labels are presentation only",
          source: "managed-result.json",
        },
      ],
    });
  });

  it("keeps partial authoritative metadata as adapter issues, not unmapped", () => {
    const converted = convertAllureResult(
      result("passed", [
        { name: "moura_traceability", value: "managed" },
        { name: "moura_case", value: "CASE-001" },
      ]),
    );
    expect(converted.unmapped).toBeUndefined();
    expect(converted.issues).toContainEqual(
      expect.objectContaining({ code: "missing-moura-requirement" }),
    );
  });

  it("reconstructs evidence only from Moura labels when Behavior labels disagree", () => {
    expect(
      convertAllureResult(
        result("passed", [
          ...hierarchyLabels("REQ-001/SCN-001/CASE-001"),
          layerLabel,
          { name: "epic", value: "REQ-999" },
          { name: "feature", value: "SCN-999" },
          { name: "story", value: "CASE-999" },
        ]),
      ).evidence,
    ).toEqual([
      {
        covers: ["REQ-001/SCN-001/CASE-001"],
        layer: "unit",
        status: "passed",
      },
    ]);
  });
});

describe("Allure results directory loading", () => {
  it("orders mixed mapped and managed-unmapped results by source filename", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-allure-"));
    temporaryDirectories.push(directory);
    await Promise.all([
      writeFile(
        join(directory, "c-result.json"),
        JSON.stringify({
          name: "third",
          labels: [{ name: "moura_traceability", value: "managed" }],
        }),
      ),
      writeFile(
        join(directory, "a-result.json"),
        JSON.stringify({
          name: "first",
          labels: [{ name: "moura_traceability", value: "managed" }],
        }),
      ),
      writeFile(
        join(directory, "b-result.json"),
        JSON.stringify(result("passed", [...hierarchyLabels(), layerLabel])),
      ),
    ]);

    const loaded = await loadAllureResultsDirectory(directory);
    expect(loaded.evidence).toHaveLength(1);
    expect(loaded.unmapped?.map(({ name, source }) => [name, source])).toEqual([
      ["first", "a-result.json"],
      ["third", "c-result.json"],
    ]);
  });

  it(
    mouraEvidenceName(
      "loads only sorted result files and reports malformed JSON deterministically",
      ["REQ-004/SCN-001/CASE-002"],
      "unit",
    ),
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "moura-allure-"));
      temporaryDirectories.push(directory);
      await Promise.all([
        writeFile(join(directory, "z-result.json"), "not json"),
        writeFile(
          join(directory, "b-result.json"),
          JSON.stringify(result("broken", [...hierarchyLabels(), layerLabel])),
        ),
        writeFile(
          join(directory, "a-result.json"),
          JSON.stringify(result("passed", [...hierarchyLabels(), layerLabel])),
        ),
        writeFile(join(directory, "ignored-container.json"), "not json"),
        writeFile(join(directory, "categories.json"), "not json"),
      ]);

      const loaded = await loadAllureResultsDirectory(directory);
      expect(
        loaded.evidence.map(({ status, source }) => [status, source]),
      ).toEqual([
        ["passed", "a-result.json"],
        ["broken", "b-result.json"],
      ]);
      expect(loaded.issues).toEqual([
        expect.objectContaining({
          code: "malformed-json",
          source: "z-result.json",
        }),
      ]);
    },
  );
});
