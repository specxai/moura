import { describe, expect, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";

import { parseDistTagVersion } from "./registry-smoke.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-006/SCN-001/CASE-002"], "unit");

describe("registry smoke", () => {
  it("reads the latest dist-tag from registry metadata", () => {
    expect(
      parseDistTagVersion(
        JSON.stringify({ latest: "1.2.3", "release.1": "1.2.2" }),
        "latest",
      ),
    ).toBe("1.2.3");
  });

  it("treats a dotted dist-tag as one literal key", () => {
    expect(
      parseDistTagVersion(
        JSON.stringify({ latest: "1.2.3", "release.1": "1.2.2" }),
        "release.1",
      ),
    ).toBe("1.2.2");
  });
});
