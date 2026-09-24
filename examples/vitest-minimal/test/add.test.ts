import { epic, feature, label, story } from "allure-js-commons";
import { expect, test } from "vitest";

import { add } from "../src/add.js";

test("adds two positive integers", async () => {
  await label("moura_traceability", "managed");
  await label("moura_requirement", "REQ-001");
  await label("moura_scenario", "SCN-001");
  await label("moura_case", "CASE-001");
  await label("moura_layer", "unit");

  await epic("REQ-001");
  await feature("SCN-001");
  await story("CASE-001");

  expect(add(2, 3)).toBe(5);
});
