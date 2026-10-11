import type { Root } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { MouraManifest } from "./manifest.js";
import {
  atxHeading,
  parseRequirementMarkdown,
  parseSpecificationMarkdown,
  type MarkdownDocument,
} from "./markdown.js";

export const GENERATED_VIEW_NOTICE = `> **Generated file — do not edit.** This Japanese view is derived from the corresponding English document in the repository root. The English document is authoritative.
>
> **生成ファイル — 編集しないでください。** この日本語版はリポジトリ直下の対応する英語文書から生成されています。英語文書が正本です。

`;

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
  readonly alt?: unknown;
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
  readonly position?: { readonly start: { readonly offset?: number } };
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
    JSON.stringify(
      blockStructure(canonical, canonicalStructure.value, role),
    ) !==
    JSON.stringify(
      blockStructure(
        withoutGeneratedNotice(generated),
        generatedStructure.value,
        role,
      ),
    )
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
        JSON.stringify([
          blockPath,
          node.type,
          node.lang ?? null,
          node.meta ?? null,
          node.value,
        ]),
      );
    if (node.type === "inlineCode")
      code.push(JSON.stringify([blockPath, node.type, node.value]));
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

  // Japanese prose can reverse "A instead of B" to "B の代わりに A".
  // Compare code values as a multiset tied to each containing block, not
  // English word order. Duplicates remain significant; code contents (including
  // command order) and fenced-code metadata remain exact.
  return { code: code.sort(), html, links, references, placements };
}

function withoutGeneratedNotice(markdown: string): string {
  return markdown.startsWith(GENERATED_VIEW_NOTICE)
    ? markdown.slice(GENERATED_VIEW_NOTICE.length)
    : markdown;
}

/** Capture block topology and content presence, never translated prose identity. */
function blockStructure(
  markdown: string,
  traceability: unknown,
  role: DocumentRole,
): unknown {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const ids = new Set<string>();
  if (role === "requirements") {
    for (const id of traceability as readonly string[]) ids.add(id);
  } else {
    const document = traceability as MarkdownDocument;
    for (const requirement of document.requirements) {
      ids.add(requirement.id);
      for (const scenario of requirement.scenarios) {
        ids.add(scenario.id);
        for (const id of scenario.cases) ids.add(id);
      }
    }
  }
  const headingProse = new Map<AstNode, boolean>();
  for (const node of tree.children) {
    if (node.type !== "heading") continue;
    const heading = atxHeading(node, markdown);
    if (!heading || !ids.has(heading.token)) continue;
    const source = markdown.slice(
      node.position!.start.offset!,
      node.position!.end.offset!,
    );
    // The existing parser recognizes this document-level heading token.
    // Remove only that declaration, never search ordinary prose for IDs.
    const tokenStart = source.indexOf(heading.token, node.depth);
    const withoutId =
      source.slice(0, tokenStart) +
      source.slice(tokenStart + heading.token.length);
    const proseTree = unified().use(remarkParse).parse(withoutId) as Root;
    headingProse.set(
      node as AstNode,
      hasProse(proseTree as AstNode, withoutId),
    );
  }
  return blockChildren(tree as AstNode, headingProse, markdown);
}

function blockChildren(
  node: AstNode,
  headingProse: ReadonlyMap<AstNode, boolean>,
  markdown: string,
): readonly unknown[] {
  if (!Array.isArray(node.children)) return [];
  return node.children.flatMap((child) => {
    const block = child as AstNode;
    if (isInlineNode(block.type)) return [];
    return [
      {
        type: block.type,
        ...(block.type === "heading" || block.type === "paragraph"
          ? {
              hasContent: hasContent(block),
              hasProse: headingProse.get(block) ?? hasProse(block, markdown),
            }
          : {}),
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
        children: blockChildren(block, headingProse, markdown),
      },
    ];
  });
}

/** Non-whitespace text, code/HTML, or image alt text constitutes block content. */
function hasContent(node: AstNode): boolean {
  if (typeof node.value === "string" && node.value.trim().length > 0)
    return true;
  if (typeof node.alt === "string" && node.alt.trim().length > 0) return true;
  return (
    Array.isArray(node.children) &&
    node.children.some((child) => hasContent(child as AstNode))
  );
}

/** Protected machine nodes cannot stand in for translatable prose. */
function hasProse(node: AstNode, markdown: string): boolean {
  if (node.type === "inlineCode" || node.type === "html") return false;
  // Autolink text is the protected URL itself, not a translatable label.
  if (
    node.type === "link" &&
    markdown[node.position?.start.offset ?? -1] === "<"
  )
    return false;
  if (node.type === "text")
    return typeof node.value === "string" && node.value.trim().length > 0;
  if (typeof node.alt === "string" && node.alt.trim().length > 0) return true;
  return (
    Array.isArray(node.children) &&
    node.children.some((child) => hasProse(child as AstNode, markdown))
  );
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
