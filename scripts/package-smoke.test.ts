import { describe, it as vitestIt } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";
import { runPackageSmoke } from "./package-smoke.js";

const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-006/SCN-001/CASE-001", "REQ-006/SCN-001/CASE-002"],
  "integration",
);

describe("published package contract", () => {
  it(
    "supports the documented contract through the installed package boundary",
    { timeout: 120_000 },
    async () => {
      await runPackageSmoke();
    },
  );
});
