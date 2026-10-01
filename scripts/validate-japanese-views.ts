import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

import { canonicalId } from "../src/id.js";
import { parseManifest, type MouraManifest } from "../src/manifest.js";
import {
  parseRequirementMarkdown,
  parseSpecificationMarkdown,
} from "../src/markdown.js";
import { isDirectExecution } from "./direct-execution.js";
import { GENERATED_VIEW_NOTICE } from "./generate-japanese-views.js";

export type DocumentRole = "requirements" | "specifications";

interface ProtectedMarkdown {
  readonly code: readonly string[];
  readonly html: readonly string[];
  readonly links: readonly string[];
  readonly idLinks: readonly string[];
  readonly references: readonly string[];
}

interface AstNode {
  readonly type?: unknown;
  readonly value?: unknown;
  readonly url?: unknown;
  readonly title?: unknown;
  readonly lang?: unknown;
  readonly meta?: unknown;
  readonly identifier?: unknown;
  readonly referenceType?: unknown;
  readonly children?: unknown;
  readonly depth?: unknown;
  readonly ordered?: unknown;
  readonly start?: unknown;
  readonly spread?: unknown;
  readonly checked?: unknown;
}

export function validateJapaneseView(
  canonical: string,
  generated: string,
  role: DocumentRole,
  manifest: MouraManifest,
): readonly string[] {
  const problems: string[] = [];
  const canonicalStructure = structure(canonical, role, "canonical", manifest);
  const generatedStructure = structure(generated, role, "generated", manifest);

  if (canonicalStructure.errors.length > 0)
    problems.push(...canonicalStructure.errors);
  if (generatedStructure.errors.length > 0)
    problems.push(...generatedStructure.errors);
  if (
    JSON.stringify(canonicalStructure.value) !==
    JSON.stringify(generatedStructure.value)
  )
    problems.push(`${role}: traceability identifiers or hierarchy changed`);

  if (
    JSON.stringify(blockStructure(canonical)) !==
    JSON.stringify(blockStructure(withoutGeneratedNotice(generated)))
  )
    problems.push(`${role}: Markdown block structure changed`);

  const protectedIdentifiers = manifestIdentifiers(manifest);
  const canonicalProtected = protectedMarkdown(canonical, protectedIdentifiers);
  const generatedProtected = protectedMarkdown(generated, protectedIdentifiers);
  for (const key of Object.keys(
    canonicalProtected,
  ) as (keyof ProtectedMarkdown)[]) {
    if (
      JSON.stringify(canonicalProtected[key]) !==
      JSON.stringify(generatedProtected[key])
    )
      problems.push(`${role}: protected Markdown ${key} changed`);
  }
  return problems;
}

function structure(
  markdown: string,
  role: DocumentRole,
  source: string,
  manifest: MouraManifest,
): { readonly value: unknown; readonly errors: readonly string[] } {
  const parsed =
    role === "requirements"
      ? parseRequirementMarkdown(markdown, source, manifest)
      : parseSpecificationMarkdown(markdown, source, manifest);
  return {
    value: parsed.value,
    errors: parsed.errors.map((item) => `${role}: ${item.message}`),
  };
}

function protectedMarkdown(
  markdown: string,
  protectedIdentifiers: ReadonlySet<string>,
): ProtectedMarkdown {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const code: string[] = [];
  const html: string[] = [];
  const links: string[] = [];
  const idLinks: string[] = [];
  const references: string[] = [];

  walk(tree as AstNode, (node) => {
    if (node.type === "code")
      code.push(
        JSON.stringify([node.lang ?? null, node.meta ?? null, node.value]),
      );
    if (node.type === "inlineCode") code.push(JSON.stringify([node.value]));
    if (node.type === "html") html.push(String(node.value));
    if (node.type === "link" || node.type === "image")
      links.push(JSON.stringify([node.type, node.url, node.title ?? null]));
    if (node.type === "linkReference" || node.type === "imageReference")
      references.push(
        JSON.stringify([node.type, node.identifier, node.referenceType]),
      );
    if (node.type === "definition")
      references.push(
        JSON.stringify([
          node.type,
          node.identifier,
          node.url,
          node.title ?? null,
        ]),
      );
    if (node.type === "link" || node.type === "linkReference") {
      const label = linkLabel(node);
      if (protectedIdentifiers.has(label))
        idLinks.push(
          JSON.stringify([
            node.type,
            label,
            node.type === "link" ? node.url : node.identifier,
          ]),
        );
    }
  });

  return { code, html, links, idLinks, references };
}

/** Compare the complete explicit link label, never substrings of prose. */
function linkLabel(node: AstNode): string {
  if (node.type === "break") return "\n";
  if (node.type === "text" || node.type === "inlineCode")
    return String(node.value);
  if (!Array.isArray(node.children)) return "";
  return node.children.map((child) => linkLabel(child as AstNode)).join("");
}

function withoutGeneratedNotice(markdown: string): string {
  return markdown.startsWith(GENERATED_VIEW_NOTICE)
    ? markdown.slice(GENERATED_VIEW_NOTICE.length)
    : markdown;
}

/** Capture block topology only; translated inline prose is intentionally free. */
function blockStructure(markdown: string): unknown {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  return blockChildren(tree as AstNode);
}

function blockChildren(node: AstNode): readonly unknown[] {
  if (!Array.isArray(node.children)) return [];
  return node.children.flatMap((child) => {
    const block = child as AstNode;
    if (isInlineNode(block.type)) return [];
    return [
      {
        type: block.type,
        ...(block.type === "heading" ? { depth: block.depth } : {}),
        ...(block.type === "list"
          ? {
              ordered: block.ordered,
              start: block.start,
              spread: block.spread,
            }
          : {}),
        ...(block.type === "listItem"
          ? { checked: block.checked, spread: block.spread }
          : {}),
        children: blockChildren(block),
      },
    ];
  });
}

function isInlineNode(type: unknown): boolean {
  return (
    typeof type === "string" &&
    [
      "text",
      "emphasis",
      "strong",
      "delete",
      "inlineCode",
      "break",
      "link",
      "image",
      "linkReference",
      "imageReference",
    ].includes(type)
  );
}

function manifestIdentifiers(manifest: MouraManifest): ReadonlySet<string> {
  const identifiers = manifest.requirements.flatMap((requirement) => [
    requirement.localId,
    canonicalId([requirement]),
    ...requirement.scenarios.flatMap((scenario) => [
      scenario.localId,
      canonicalId([requirement, scenario]),
      ...scenario.cases.flatMap((testCase) => [
        testCase.localId,
        canonicalId([requirement, scenario, testCase]),
      ]),
    ]),
  ]);
  return new Set(identifiers);
}

function walk(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  if (!Array.isArray(node.children)) return;
  for (const child of node.children) walk(child as AstNode, visit);
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? ".");
  const manifestResult = parseManifest(
    await readFile(resolve(root, "moura.yaml"), "utf8"),
  );
  if (!manifestResult.value || manifestResult.errors.length > 0)
    throw new Error(
      `Cannot validate generated views with an invalid manifest:\n${manifestResult.errors.map((item) => item.message).join("\n")}`,
    );

  const pairs = [
    ["req.md", "docs/ja/req.md", "requirements"],
    ["spec.md", "docs/ja/spec.md", "specifications"],
  ] as const;
  const problems = (
    await Promise.all(
      pairs.map(async ([canonicalPath, generatedPath, role]) =>
        validateJapaneseView(
          await readFile(resolve(root, canonicalPath), "utf8"),
          await readFile(resolve(root, generatedPath), "utf8"),
          role,
          manifestResult.value!,
        ).map((problem) => `${generatedPath}: ${problem}`),
      ),
    )
  ).flat();
  if (problems.length > 0)
    throw new Error(
      `Japanese view integrity validation failed:\n${problems.join("\n")}`,
    );
  console.log(
    "Japanese generated views preserve Moura traceability invariants.",
  );
}

if (isDirectExecution(import.meta.url))
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
