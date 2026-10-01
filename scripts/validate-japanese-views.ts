import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";

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
  readonly references: readonly string[];
  readonly placements: readonly string[];
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

  const canonicalProtected = protectedMarkdown(canonical);
  const generatedProtected = protectedMarkdown(
    withoutGeneratedNotice(generated),
  );
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

function protectedMarkdown(markdown: string): ProtectedMarkdown {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const code: string[] = [];
  const html: string[] = [];
  const links: string[] = [];
  const references: string[] = [];
  const placements: string[] = [];

  walk(tree as AstNode, (node, blockPath) => {
    if (
      [
        "code",
        "inlineCode",
        "html",
        "link",
        "image",
        "linkReference",
        "imageReference",
        "definition",
      ].includes(String(node.type))
    )
      placements.push(JSON.stringify([node.type, blockPath]));
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
  });

  return { code, html, links, references, placements };
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

/** Track containing blocks without making translated prose or inline formatting identity. */
function walk(
  node: AstNode,
  visit: (node: AstNode, blockPath: readonly number[]) => void,
  blockPath: readonly number[] = [],
): void {
  visit(node, blockPath);
  if (!Array.isArray(node.children)) return;
  let blockIndex = 0;
  for (const child of node.children) {
    const next = child as AstNode;
    walk(
      next,
      visit,
      isInlineNode(next.type) ? blockPath : [...blockPath, blockIndex++],
    );
  }
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
