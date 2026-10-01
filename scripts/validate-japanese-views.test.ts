import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it as vitestIt } from "vitest";

import { parseManifest } from "../src/manifest.js";
import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";
import { isDirectExecution } from "./direct-execution.js";
import { GENERATED_VIEW_NOTICE } from "./generate-japanese-views.js";
import { validateJapaneseView } from "./validate-japanese-views.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-008/SCN-001/CASE-001"], "unit");

const manifest = parseManifest(`
version: 1
sources:
  requirements: [req.md]
  specifications: [spec.md]
verification:
  layers: [unit]
requirements:
  - id: REQ-001
    scenarios:
      - id: feature+🚀
        cases:
          - { id: CASE-001, verify: [unit] }
`).value!;

const orderedManifest = parseManifest(`
version: 1
sources:
  requirements: [req.md]
  specifications: [spec.md]
verification:
  layers: [unit]
requirements:
  - id: REQ-001
    scenarios:
      - id: feature+🚀
        cases:
          - { id: CASE-001, verify: [unit] }
  - id: REQ-002
    scenarios:
      - id: SCN-002
        cases:
          - { id: CASE-002, verify: [unit] }
`).value!;

const canonical = `# Specification

## REQ-001 Read a file

### feature+🚀 Validate input

#### CASE-001 Keep machine values

Run \`moura validate .\` against [the manifest](moura.yaml). Scenario feature+🚀 uses canonical Case REQ-001/feature+🚀/CASE-001.

\`\`\`yaml
version: 1
\`\`\`
`;

const translated = `# 仕様

## REQ-001 ファイルを読む

### feature+🚀 入力を検証する

#### CASE-001 機械可読値を維持する

\`moura validate .\` を実行し、[マニフェスト](moura.yaml)を検証する。シナリオ feature+🚀 の正規Caseは REQ-001/feature+🚀/CASE-001。

\`\`\`yaml
version: 1
\`\`\`
`;

describe("Japanese view integrity", () => {
  it("allows human-readable prose to differ", () => {
    expect(
      validateJapaneseView(canonical, translated, "specifications", manifest),
    ).toEqual([]);
    expect(
      validateJapaneseView(
        canonical,
        `${GENERATED_VIEW_NOTICE}${translated}`,
        "specifications",
        manifest,
      ),
    ).toEqual([]);
  });

  it("detects traceability identifier and hierarchy drift", () => {
    const changedId = translated.replace("CASE-001", "CASE-002");
    const changedHierarchy = translated.replace(
      "### feature+🚀",
      "# feature+🚀",
    );
    expect(
      validateJapaneseView(canonical, changedId, "specifications", manifest),
    ).toContain(
      "specifications: traceability identifiers or hierarchy changed",
    );
    expect(
      validateJapaneseView(
        canonical,
        changedHierarchy,
        "specifications",
        manifest,
      ),
    ).toContain(
      "specifications: traceability identifiers or hierarchy changed",
    );
  });

  it("detects changes to code, commands, paths, and identifiers in prose", () => {
    const changed = translated
      .replace("moura validate .", "moura check .")
      .replace("moura.yaml", "moura-ja.yaml")
      .replace("version: 1", "version: 2");
    expect(
      validateJapaneseView(canonical, changed, "specifications", manifest),
    ).toEqual([
      "specifications: protected Markdown code changed",
      "specifications: protected Markdown links changed",
    ]);
  });

  it("derives protected local and canonical IDs from the manifest", () => {
    const changedLocal = translated.replace(
      "シナリオ feature+🚀 の正規Caseは",
      "シナリオ feature変更 の正規Caseは",
    );
    const changedCanonical = translated.replace(
      "REQ-001/feature+🚀/CASE-001。",
      "REQ-001/feature変更/CASE-001。",
    );
    expect(
      validateJapaneseView(canonical, changedLocal, "specifications", manifest),
    ).toContain("specifications: protected Markdown identifiers changed");
    expect(
      validateJapaneseView(
        canonical,
        changedCanonical,
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown identifiers changed");
  });

  it("preserves identifier occurrences in prose source order", () => {
    const source = "REQ-001 and REQ-002";

    expect(
      validateJapaneseView(
        source,
        "REQ-001 and REQ-002",
        "specifications",
        orderedManifest,
      ),
    ).toEqual([]);
    expect(
      validateJapaneseView(
        source,
        "REQ-002 and REQ-001",
        "specifications",
        orderedManifest,
      ),
    ).toContain("specifications: protected Markdown identifiers changed");
  });

  it("uses the longest identifier at overlapping occurrence positions", () => {
    const source = "REQ-001/feature+🚀/CASE-001 then feature+🚀 then REQ-001";

    expect(
      validateJapaneseView(source, source, "specifications", orderedManifest),
    ).toEqual([]);
    expect(
      validateJapaneseView(
        source,
        "feature+🚀 then REQ-001/feature+🚀/CASE-001 then REQ-001",
        "specifications",
        orderedManifest,
      ),
    ).toContain("specifications: protected Markdown identifiers changed");
  });

  it("rejects an identifier changed by adjacent identifier characters", () => {
    expect(
      validateJapaneseView(
        "See REQ-001",
        "See REQ-001-ja",
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown identifiers changed");
  });

  it("accepts whitespace between preserved identifiers and Japanese prose", () => {
    expect(
      validateJapaneseView(
        "See REQ-001 for details.",
        "詳細は REQ-001 を参照してください。",
        "specifications",
        manifest,
      ),
    ).toEqual([]);
    expect(
      validateJapaneseView(
        "REQ-001 is required.",
        "REQ-001 は必須です。",
        "specifications",
        manifest,
      ),
    ).toEqual([]);
  });

  it("rejects identifier mutations and directly concatenated prose", () => {
    for (const japanese of [
      "詳細は REQ-001-ja を参照してください。",
      "詳細は ja-REQ-001 を参照してください。",
      "詳細は REQ-001を参照してください。",
    ]) {
      expect(
        validateJapaneseView(
          "See REQ-001 for details.",
          japanese,
          "specifications",
          manifest,
        ),
      ).toContain("specifications: protected Markdown identifiers changed");
    }
  });

  it("does not double count local IDs inside canonical IDs", () => {
    expect(
      validateJapaneseView(
        "REQ-001/feature+🚀/CASE-001",
        "REQ-001/feature+🚀/CASE-001 REQ-001 feature+🚀 CASE-001",
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown identifiers changed");
  });

  it("preserves HTML tags exactly", () => {
    const source = '<span data-id="REQ-001">fixed</span>';
    expect(
      validateJapaneseView(source, source, "specifications", manifest),
    ).toEqual([]);
    expect(
      validateJapaneseView(
        source,
        source.replace("data-id", "data-other"),
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown html changed");
  });

  it("rejects omitted prose blocks without comparing translated meaning", () => {
    const source = `## REQ-001

This requirement ensures that the CLI remains predictable.

Additional operational notes are important.
`;
    const japanese = `## REQ-001

この要件によりCLIの動作が予測可能になります。
`;

    expect(
      validateJapaneseView(source, japanese, "requirements", manifest),
    ).toContain("requirements: Markdown block structure changed");
  });

  it("preserves translatable Markdown block topology", () => {
    const source = `# Guide

> Important guidance.

- First item
  - Nested item
- Second item

1. Ordered item
`;
    const japanese = `# ガイド

> 重要な案内です。

- 最初の項目
  - 入れ子の項目
- 2番目の項目

1. 順序付き項目
`;
    const missingListItem = japanese.replace("- 2番目の項目\n", "");

    expect(
      validateJapaneseView(source, japanese, "requirements", manifest),
    ).toEqual([]);
    expect(
      validateJapaneseView(source, missingListItem, "requirements", manifest),
    ).toContain("requirements: Markdown block structure changed");
  });

  it("protects reference-style link and image semantics while allowing labels to translate", () => {
    const source = `${canonical}
[documentation][docs] ![diagram][architecture]

[docs]: ./docs/example.md
[architecture]: ./docs/architecture.png
`;
    const japanese = `${translated}
[文書][docs] ![構成図][architecture]

[docs]: ./docs/example.md
[architecture]: ./docs/architecture.png
`;
    expect(
      validateJapaneseView(source, japanese, "specifications", manifest),
    ).toEqual([]);
    expect(
      validateJapaneseView(
        source,
        japanese.replace("[文書][docs]", "[文書][other]"),
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown references changed");
    expect(
      validateJapaneseView(
        source,
        japanese.replace("./docs/architecture.png", "./docs/other.png"),
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown references changed");
    expect(
      validateJapaneseView(
        source,
        japanese.replace("[docs]: ./docs/example.md\n", ""),
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown references changed");
  });

  it("recognizes entry paths containing URL-significant characters", () => {
    const entry = resolve("temporary # ? % directory", "script.ts");
    expect(isDirectExecution(pathToFileURL(entry).href, entry)).toBe(true);
  });
});
