import { readFileSync, readdirSync } from "node:fs";

interface AllureTreeNode {
  readonly name?: unknown;
  readonly groups?: unknown;
  readonly leaves?: unknown;
}

export function verifyBehaviorTree(
  value: unknown,
  hierarchy: readonly [string, string, string],
  testName: string,
): void {
  if (!isRecord(value)) throw new Error("Allure tree must be an object");
  const root = value.root;
  const groups = value.groupsById;
  const leaves = value.leavesById;
  if (!isTreeNode(root) || !isRecord(groups) || !isRecord(leaves))
    throw new Error("Allure tree has an invalid structure");

  let node = root;
  for (const expectedName of hierarchy) {
    const child = nodeIds(node.groups)
      .map((id) => groups[id])
      .find(
        (candidate): candidate is AllureTreeNode =>
          isTreeNode(candidate) && candidate.name === expectedName,
      );
    if (!child)
      throw new Error(
        `Allure Behavior tree is missing hierarchy node ${expectedName}`,
      );
    node = child;
  }

  const hasTest = nodeIds(node.leaves).some(
    (id) => isTreeNode(leaves[id]) && leaves[id].name === testName,
  );
  if (!hasTest)
    throw new Error(
      `Allure Behavior tree is missing test ${JSON.stringify(testName)}`,
    );
}

export function verifyCompleteBehaviorTree(
  value: unknown,
  expectedTests: number,
): void {
  if (!isRecord(value)) throw new Error("Allure tree must be an object");
  const root = value.root;
  const groups = value.groupsById;
  const leaves = value.leavesById;
  if (!isTreeNode(root) || !isRecord(groups) || !isRecord(leaves))
    throw new Error("Allure tree has an invalid structure");

  const foundLeaves = new Set<string>();
  const visit = (node: AllureTreeNode, depth: number): void => {
    const directLeaves = nodeIds(node.leaves);
    if (directLeaves.length > 0 && depth !== 3)
      throw new Error(
        `Allure Behavior tree contains ${directLeaves.length} test(s) at hierarchy depth ${depth}`,
      );
    for (const id of directLeaves) {
      if (!isTreeNode(leaves[id]))
        throw new Error(`Allure Behavior tree references unknown test ${id}`);
      foundLeaves.add(id);
    }
    for (const id of nodeIds(node.groups)) {
      const child = groups[id];
      if (!isTreeNode(child))
        throw new Error(`Allure Behavior tree references unknown group ${id}`);
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  if (foundLeaves.size !== expectedTests)
    throw new Error(
      `Allure Behavior tree contains ${foundLeaves.size} traced tests; expected ${expectedTests}`,
    );
}

function nodeIds(value: unknown): readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTreeNode(value: unknown): value is AllureTreeNode {
  return isRecord(value);
}

if (process.argv[1]?.endsWith("verify-allure-report.ts")) {
  const tree: unknown = JSON.parse(
    readFileSync("allure-report/widgets/tree.json", "utf8"),
  );
  verifyBehaviorTree(
    tree,
    ["REQ-002", "SCN-001", "CASE-002"],
    "aggregates an empty set of evidence as MISSING",
  );
  const expectedTests = readdirSync("allure-results").filter((file) =>
    file.endsWith("-result.json"),
  ).length;
  verifyCompleteBehaviorTree(tree, expectedTests);
  console.log(
    `Verified Requirement → Scenario → Case → Test paths for ${expectedTests} Allure results with no unmapped root tests.`,
  );
}
