import { describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "./test-support/moura-evidence.js";

import {
  canonicalId,
  InvalidLocalIdError,
  localId,
  safeDisplayString,
} from "./id.js";
import type { TraceNode } from "./model.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-001/SCN-001/CASE-008"], "unit");

const requirement: TraceNode = { kind: "requirement", localId: "REQ-001" };
const scenario: TraceNode = { kind: "scenario", localId: "SCN-001" };
const testCase: TraceNode = { kind: "case", localId: "CASE-001" };

describe("canonicalId", () => {
  it("builds IDs from each valid hierarchy level", () => {
    expect(canonicalId([requirement])).toBe("REQ-001");
    expect(canonicalId([requirement, scenario])).toBe("REQ-001/SCN-001");
    expect(canonicalId([requirement, scenario, testCase])).toBe(
      "REQ-001/SCN-001/CASE-001",
    );
  });

  it("rejects a slash in any local ID", () => {
    expect(() => localId("SCN/001")).toThrow(InvalidLocalIdError);
    expect(() =>
      canonicalId([requirement, { kind: "scenario", localId: "SCN/001" }]),
    ).toThrow(InvalidLocalIdError);
  });

  it("rejects whitespace in any local ID", () => {
    for (const value of [
      "LOGIN FLOW",
      "REQ 001",
      "SCN- 001",
      "CASE-\t001",
      "REQ-\u0085001",
    ]) {
      expect(() => localId(value)).toThrow(InvalidLocalIdError);
    }

    expect(() =>
      canonicalId([requirement, { kind: "scenario", localId: "SCN\t001" }]),
    ).toThrow(InvalidLocalIdError);
  });

  it("accepts IDs without whitespace or the reserved separator", () => {
    for (const value of [
      "REQ-001",
      "SCN-001",
      "CASE-001",
      "login-flow",
      "login_flow",
      "REQ-\uFEFF001",
      "要件-一",
      "CASE-😀",
    ]) {
      expect(localId(value)).toBe(value);
    }
  });

  it("rejects Unicode controls and unpaired UTF-16 surrogates", () => {
    for (const value of [
      "ID\u0000",
      "ID\u0001",
      "ID\u007f",
      "ID\u009f",
      "ID\ud800",
      "ID\udfff",
    ])
      expect(() => localId(value)).toThrow(InvalidLocalIdError);
  });

  it("rejects an invalid hierarchy", () => {
    expect(() => canonicalId([scenario])).toThrow(/Invalid node hierarchy/);
  });

  it.each([
    ["newline", "test\nERROR injected", '"test\\nERROR injected"'],
    ["carriage return", "test\rERROR injected", '"test\\rERROR injected"'],
    ["ANSI escape", "test\u001b[31mERROR", "testERROR"],
    ["C0 control", "test\u0001ERROR", '"test\\u0001ERROR"'],
    ["DEL", "test\u007fERROR", '"test\\u007fERROR"'],
    ["NEL", "test\u0085ERROR", '"test\\u0085ERROR"'],
    ["CSI sequence", "test\u009b31mERROR", "testERROR"],
    ["C1 control", "test\u009fERROR", '"test\\u009fERROR"'],
    ["line separator", "test\u2028ERROR", '"test\\u2028ERROR"'],
    ["paragraph separator", "test\u2029ERROR", '"test\\u2029ERROR"'],
    ["bidi override", "test\u202eERROR", '"test\\u202eERROR"'],
    ["bidi isolate", "test\u2067ERROR", '"test\\u2067ERROR"'],
  ])(
    "renders %s as a visible single-line display string",
    (_kind, value, expected) => {
      expect(safeDisplayString(value)).toBe(expected);
      expect(
        [...safeDisplayString(value)].every((character) => {
          const codePoint = character.codePointAt(0)!;
          return !(
            codePoint <= 0x1f ||
            (codePoint >= 0x7f && codePoint <= 0x9f) ||
            codePoint === 0x2028 ||
            codePoint === 0x2029 ||
            /\p{Bidi_Control}/u.test(character)
          );
        }),
      ).toBe(true);
    },
  );

  it.each(["ordinary test name", "Unicode テスト 😀", "accentué"])(
    "preserves safe display text %s",
    (value) => expect(safeDisplayString(value)).toBe(value),
  );
});
