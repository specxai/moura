import { describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";

import {
  verifyBehaviorTree,
  verifyCompleteBehaviorTree,
} from "./verify-allure-report.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-005/SCN-002/CASE-001"], "unit");

const tree = {
  root: { groups: ["requirement"] },
  groupsById: {
    requirement: { name: "REQ-002", groups: ["scenario"] },
    scenario: { name: "SCN-001", groups: ["case"] },
    case: { name: "CASE-002", leaves: ["test"] },
  },
  leavesById: {
    test: { name: "aggregates an empty set of evidence as MISSING" },
  },
};

describe("Allure Behavior report verification", () => {
  it("accepts a Requirement → Scenario → Case → Test tree", () => {
    expect(() =>
      verifyBehaviorTree(
        tree,
        ["REQ-002", "SCN-001", "CASE-002"],
        "aggregates an empty set of evidence as MISSING",
      ),
    ).not.toThrow();
  });

  it("rejects a tree that skips the configured Behavior hierarchy", () => {
    expect(() =>
      verifyBehaviorTree(
        tree,
        ["REQ-002", "CASE-002", "SCN-001"],
        "aggregates an empty set of evidence as MISSING",
      ),
    ).toThrow("missing hierarchy node CASE-002");
  });

  it("rejects a hierarchy without the representative test leaf", () => {
    expect(() =>
      verifyBehaviorTree(
        tree,
        ["REQ-002", "SCN-001", "CASE-002"],
        "another test",
      ),
    ).toThrow('missing test "another test"');
  });

  it("accepts only tests nested below all three Behavior levels", () => {
    expect(() => verifyCompleteBehaviorTree(tree, 1)).not.toThrow();
  });

  it("rejects an unmapped root-level test", () => {
    expect(() =>
      verifyCompleteBehaviorTree(
        {
          ...tree,
          root: { ...tree.root, leaves: ["test"] },
        },
        1,
      ),
    ).toThrow("1 test(s) at hierarchy depth 0");
  });
});
