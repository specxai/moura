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

export type DocumentRole = "requirements" | "specifications";

interface ProtectedMarkdown {
  readonly code: readonly string[];
  readonly html: readonly string[];
  readonly links: readonly string[];
  readonly identifiers: readonly string[];
}

interface AstNode {
  readonly type?: unknown;
  readonly value?: unknown;
  readonly url?: unknown;
  readonly title?: unknown;
  readonly lang?: unknown;
  readonly meta?: unknown;
  readonly children?: unknown;
}

const identifierPattern =
  /\b(?:REQ|SCN|CASE)-[\p{L}\p{N}._~-]+(?:\/(?:REQ|SCN|CASE)-[\p{L}\p{N}._~-]+)*\b/gu;

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

  const canonicalProtected = protectedMarkdown(canonical);
  const generatedProtected = protectedMarkdown(generated);
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
  const identifiers: string[] = [];

  walk(tree as AstNode, (node) => {
    if (node.type === "code")
      code.push(
        JSON.stringify([node.lang ?? null, node.meta ?? null, node.value]),
      );
    if (node.type === "inlineCode") code.push(JSON.stringify([node.value]));
    if (node.type === "html") html.push(String(node.value));
    if (node.type === "link" || node.type === "image")
      links.push(JSON.stringify([node.type, node.url, node.title ?? null]));
    if (typeof node.value === "string")
      identifiers.push(...(node.value.match(identifierPattern) ?? []));
  });

  return { code, html, links, identifiers };
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

const entry = process.argv[1];
if (entry && import.meta.url === new URL(`file://${resolve(entry)}`).href)
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
