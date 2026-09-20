import { afterEach, describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceName, mouraEvidenceTest } from "./moura-evidence.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-005/SCN-001/CASE-001"], "unit");

const originalMetadata = process.env.MOURA_ALLURE_METADATA;

afterEach(() => {
  if (originalMetadata === undefined) delete process.env.MOURA_ALLURE_METADATA;
  else process.env.MOURA_ALLURE_METADATA = originalMetadata;
});

describe("Moura Allure metadata names", () => {
  it("derives authoritative and Behavior hierarchy labels from one canonical Case ID", () => {
    process.env.MOURA_ALLURE_METADATA = "true";
    expect(
      mouraEvidenceName("evidence", ["REQ-002/SCN-001/CASE-002"], "unit"),
    ).toBe(
      "evidence @allure.label.moura_traceability:managed " +
        "@allure.label.moura_requirement:REQ-002 " +
        "@allure.label.moura_scenario:SCN-001 " +
        "@allure.label.moura_case:CASE-002 @allure.label.moura_layer:unit " +
        "@allure.label.epic:REQ-002 @allure.label.feature:SCN-001 " +
        "@allure.label.story:CASE-002",
    );
  });

  it("keeps every Moura tuple and projects only the first Case for multiple Cases", () => {
    process.env.MOURA_ALLURE_METADATA = "true";
    const name = mouraEvidenceName(
      "evidence",
      ["REQ-001/SCN-001/CASE-001", "REQ-002/SCN-002/CASE-002"],
      "unit",
    );
    expect(name.match(/moura_requirement:/gu)).toHaveLength(2);
    expect(name.match(/moura_scenario:/gu)).toHaveLength(2);
    expect(name.match(/moura_case:/gu)).toHaveLength(2);
    expect(name).toContain("@allure.label.epic:REQ-001");
    expect(name).toContain("@allure.label.feature:SCN-001");
    expect(name).toContain("@allure.label.story:CASE-001");
    expect(name.match(/@allure\.label\.epic:/gu)).toHaveLength(1);
    expect(name.match(/@allure\.label\.feature:/gu)).toHaveLength(1);
    expect(name.match(/@allure\.label\.story:/gu)).toHaveLength(1);
    expect(name).not.toContain("@allure.label.story:CASE-002");
  });

  it("rejects an invalid canonical Case ID before emitting either projection", () => {
    process.env.MOURA_ALLURE_METADATA = "true";
    expect(() =>
      mouraEvidenceName("evidence", ["REQ-001/CASE-001"], "unit"),
    ).toThrowError("Invalid canonical Moura Case ID: REQ-001/CASE-001");
  });
});
