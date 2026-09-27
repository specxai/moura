import type { MouraManifest } from "./manifest.js";
import type { Heading as MdastHeading, Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  error,
  type ValidationError,
  type ValidationResult,
} from "./validation.js";

export interface MarkdownRequirement {
  readonly id: string;
  readonly scenarios: readonly MarkdownScenario[];
}
export interface MarkdownScenario {
  readonly id: string;
  readonly cases: readonly string[];
}
export interface MarkdownDocument {
  readonly requirements: readonly MarkdownRequirement[];
}

/** Presentation metadata for a Requirement declaration; it is not identity. */
export interface RequirementSourceLocation {
  readonly source: string;
  readonly anchor: string;
  readonly line: number;
}

interface Heading {
  readonly depth: number;
  readonly token: string;
  readonly line: number;
}

const RESERVED_ID_PREFIXES = ["REQ-", "SCN-", "CASE-"] as const;

export function parseRequirementMarkdown(
  text: string,
  source: string,
  manifest: MouraManifest,
): ValidationResult<readonly string[]> {
  const requirementIds = new Set(
    manifest.requirements.map((item) => item.localId),
  );
  const managedIds = manifestManagedIds(manifest);
  const requirements = headings(text)
    .filter(
      ({ token }) =>
        requirementIds.has(token) ||
        (hasReservedIdPrefix(token) && !managedIds.has(token)),
    )
    .map(({ token }) => token);
  return { value: requirements, errors: [] };
}

export function locateRequirementMarkdown(
  text: string,
  source: string,
  manifest: MouraManifest,
): ReadonlyMap<string, RequirementSourceLocation> {
  const requirementIds = new Set(
    manifest.requirements.map((item) => item.localId),
  );
  return new Map(
    headings(text)
      .filter(({ token }) => requirementIds.has(token))
      .map(({ token, line }) => [
        token,
        { source, anchor: requirementAnchor(token), line },
      ]),
  );
}

export function parseSpecificationMarkdown(
  text: string,
  source: string,
  manifest: MouraManifest,
): ValidationResult<MarkdownDocument> {
  const errors: ValidationError[] = [];
  const reqIds = new Set(manifest.requirements.map((node) => node.localId));
  const scnIds = new Set(
    manifest.requirements.flatMap((node) =>
      node.scenarios.map((child) => child.localId),
    ),
  );
  const caseIds = new Set(
    manifest.requirements.flatMap((node) =>
      node.scenarios.flatMap((child) =>
        child.cases.map((leaf) => leaf.localId),
      ),
    ),
  );
  const declaredIds = manifestManagedIds(manifest);
  const result: { id: string; scenarios: { id: string; cases: string[] }[] }[] =
    [];
  let currentRequirement: (typeof result)[number] | undefined;
  let requirementDepth = 0;
  let currentScenario: (typeof result)[number]["scenarios"][number] | undefined;
  let scenarioDepth = 0;

  for (const heading of headings(text)) {
    if (currentScenario && heading.depth <= scenarioDepth)
      currentScenario = undefined;
    if (currentRequirement && heading.depth <= requirementDepth)
      currentRequirement = undefined;

    const kind = classify(
      heading,
      currentRequirement,
      currentScenario,
      manifest,
      reqIds,
      scnIds,
      caseIds,
      declaredIds,
      requirementDepth,
      scenarioDepth,
    );
    if (!kind) {
      continue;
    }
    if (kind === "requirement") {
      currentRequirement = { id: heading.token, scenarios: [] };
      result.push(currentRequirement);
      requirementDepth = heading.depth;
      currentScenario = undefined;
    } else if (kind === "scenario") {
      if (!currentRequirement || heading.depth <= requirementDepth) {
        errors.push(
          error(
            "invalid-markdown-hierarchy",
            `${heading.token} is not beneath a Requirement heading in ${source}`,
            { source },
          ),
        );
        currentScenario = undefined;
      } else {
        currentScenario = { id: heading.token, cases: [] };
        currentRequirement.scenarios.push(currentScenario);
        scenarioDepth = heading.depth;
      }
    } else if (
      !currentRequirement ||
      !currentScenario ||
      heading.depth <= scenarioDepth
    ) {
      errors.push(
        error(
          "invalid-markdown-hierarchy",
          `${heading.token} is not beneath a Scenario heading in ${source}`,
          { source },
        ),
      );
    } else {
      currentScenario.cases.push(heading.token);
    }
  }
  return { value: { requirements: result }, errors };
}

function headings(text: string): Heading[] {
  const tree = unified().use(remarkParse).parse(text) as Root;
  // Moura structure is expressed only by document-level headings. A heading
  // nested in a block quote, list, or another container is content belonging
  // to that container, not an active Requirement, Scenario, or Case.
  return tree.children.flatMap((node) => {
    if (node.type !== "heading") return [];
    const heading = atxHeading(node, text);
    return heading ? [heading] : [];
  });
}

function atxHeading(node: MdastHeading, markdown: string): Heading | undefined {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) return undefined;

  // Use the original source for Moura's token rather than imposing an ID
  // alphabet here. remark-parse remains responsible for Markdown syntax.
  const source = markdown.slice(start, end);
  const marker = new RegExp(`^#{${node.depth}}(?:[\\t ]+|$)`, "u").exec(source);
  if (!marker) return undefined; // Excludes Setext headings.
  const token = /^[\p{White_Space}]*([^\p{White_Space}]+)/u.exec(
    source.slice(marker[0].length),
  )?.[1];
  if (!token) return undefined;
  return { depth: node.depth, token, line: node.position!.start.line };
}

function requirementAnchor(value: string): string {
  return `requirement-${Array.from(value, (character) =>
    character.codePointAt(0)!.toString(16),
  ).join("-")}`;
}

function classify(
  heading: Heading,
  requirement: MarkdownRequirement | undefined,
  scenario: MarkdownScenario | undefined,
  manifest: MouraManifest,
  requirements: Set<string>,
  scenarios: Set<string>,
  cases: Set<string>,
  declaredIds: Set<string>,
  requirementDepth: number,
  scenarioDepth: number,
): "requirement" | "scenario" | "case" | undefined {
  const { depth, token } = heading;
  const manifestRequirement = requirement
    ? manifest.requirements.find((item) => item.localId === requirement.id)
    : undefined;
  const manifestScenario = scenario
    ? manifestRequirement?.scenarios.find(
        (item) => item.localId === scenario.id,
      )
    : undefined;

  // The active ancestors and relative heading depth disambiguate scoped local
  // IDs. Prefixes are only used to notice an undeclared managed token below.
  if (
    scenario &&
    depth > scenarioDepth &&
    manifestScenario?.cases.some((item) => item.localId === token)
  )
    return "case";
  if (
    requirement &&
    depth > requirementDepth &&
    manifestRequirement?.scenarios.some((item) => item.localId === token)
  )
    return "scenario";
  if (requirements.has(token)) return "requirement";
  // A declared ID that has only one possible kind remains identifiable when
  // its expected parent is missing, so the caller can report bad hierarchy.
  if (scenarios.has(token) && !cases.has(token)) return "scenario";
  if (cases.has(token) && !scenarios.has(token)) return "case";

  const managed = declaredIds.has(token) || hasReservedIdPrefix(token);
  if (!managed) return undefined;
  if (scenario && depth > scenarioDepth) return "case";
  if (requirement && depth > requirementDepth) return "scenario";
  return "requirement";
}

function hasReservedIdPrefix(token: string): boolean {
  return RESERVED_ID_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/**
 * Classifies whether a token is managed by the manifest, independently of the
 * source role and hierarchy checks that determine where that node may occur.
 */
function manifestManagedIds(manifest: MouraManifest): Set<string> {
  return new Set(
    manifest.requirements.flatMap((requirement) => [
      requirement.localId,
      ...requirement.scenarios.flatMap((scenario) => [
        scenario.localId,
        ...scenario.cases.map((testCase) => testCase.localId),
      ]),
    ]),
  );
}
