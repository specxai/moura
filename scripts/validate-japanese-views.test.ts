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

  it("detects changes to protected code, commands, and paths", () => {
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

  it("does not infer identifiers from ordinary prose", () => {
    for (const generated of [
      "See REQ-001 for details.",
      "See REQ-001# for details.",
      "See x.REQ-001 for details.",
      "詳細は REQ-001を参照してください。",
      "詳細は REQ-001-ja を参照してください。",
      "feature+🚀 foo#bar",
      "REQ-002 and REQ-001",
    ]) {
      expect(
        validateJapaneseView(
          "See REQ-001 for details.",
          generated,
          "specifications",
          orderedManifest,
        ),
      ).toEqual([]);
    }
  });

  it("preserves every heading ID and rejects omissions", () => {
    for (const [id, replacement] of [
      ["REQ-001", "REQ-001#"],
      ["feature+🚀", "feature+🚀-ja"],
      ["CASE-001", "x.CASE-001"],
    ]) {
      expect(
        validateJapaneseView(
          canonical,
          translated.replace(id!, replacement!),
          "specifications",
          manifest,
        ),
      ).toContain(
        "specifications: traceability identifiers or hierarchy changed",
      );
    }
    for (const heading of [
      "## REQ-001 ファイルを読む",
      "### feature+🚀 入力を検証する",
      "#### CASE-001 機械可読値を維持する",
    ]) {
      expect(
        validateJapaneseView(
          canonical,
          translated.replace(heading, ""),
          "specifications",
          manifest,
        ),
      ).toContain(
        "specifications: traceability identifiers or hierarchy changed",
      );
    }
    expect(
      validateJapaneseView(
        "## REQ-001",
        "## REQ-001#",
        "requirements",
        manifest,
      ),
    ).toContain("requirements: traceability identifiers or hierarchy changed");
  });

  it("preserves traceability heading order", () => {
    const source =
      "## REQ-001\n### feature+🚀\n#### CASE-001\n\n## REQ-002\n### SCN-002\n#### CASE-002\n";
    const reversed =
      "## REQ-002\n### SCN-002\n#### CASE-002\n\n## REQ-001\n### feature+🚀\n#### CASE-001\n";
    expect(
      validateJapaneseView(source, reversed, "specifications", orderedManifest),
    ).toContain(
      "specifications: traceability identifiers or hierarchy changed",
    );
  });

  it("preserves Scenario and Case heading order", () => {
    const siblingManifest = parseManifest(`
version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit] }
requirements:
  - id: R
    scenarios:
      - id: S1
        cases: [{ id: C1, verify: [unit] }, { id: C2, verify: [unit] }]
      - id: S2
        cases: [{ id: C3, verify: [unit] }]
`).value!;
    const source = "## R\n### S1\n#### C1\n#### C2\n### S2\n#### C3\n";
    for (const generated of [
      "## R\n### S1\n#### C2\n#### C1\n### S2\n#### C3\n",
      "## R\n### S2\n#### C3\n### S1\n#### C1\n#### C2\n",
    ]) {
      expect(
        validateJapaneseView(
          source,
          generated,
          "specifications",
          siblingManifest,
        ),
      ).toContain(
        "specifications: traceability identifiers or hierarchy changed",
      );
    }
  });

  it("preserves exact local and canonical ID link labels with destinations and order", () => {
    const source =
      "See [REQ-001](target-a), [feature+🚀](target-b), and [REQ-001/feature+🚀/CASE-001](target-c).";
    expect(
      validateJapaneseView(
        source,
        source.replace("See", "参照"),
        "specifications",
        manifest,
      ),
    ).toEqual([]);
    for (const generated of [
      source.replace("[REQ-001]", "[REQ-001#]"),
      source.replace("[feature+🚀]", "[変更]"),
      source.replace("[REQ-001/feature+🚀/CASE-001]", "[CASE-001]"),
      source.replace("target-a", "other"),
      "See [feature+🚀](target-b), [REQ-001](target-a), and [REQ-001/feature+🚀/CASE-001](target-c).",
      source.replace("[REQ-001](target-a)", "REQ-001"),
    ]) {
      expect(
        validateJapaneseView(source, generated, "specifications", manifest),
      ).toContain("specifications: protected Markdown idLinks changed");
    }
    // Destination/label associations remain protected even when label order is unchanged.
    expect(
      validateJapaneseView(
        source,
        source
          .replace("target-a", "target-b")
          .replace("[feature+🚀](target-b)", "[feature+🚀](target-a)"),
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown idLinks changed");
  });

  it("compares complete link labels without scanning substrings", () => {
    const source = "[See REQ-001](target)";
    expect(
      validateJapaneseView(
        source,
        "[詳細は REQ-001#](target)",
        "specifications",
        manifest,
      ),
    ).toEqual([]);
    expect(
      validateJapaneseView(
        "[**REQ-001**](target)",
        "[**変更**](target)",
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown idLinks changed");
    const punctuationManifest = parseManifest(`
version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit] }
requirements:
  - id: foo#bar
    scenarios:
      - id: feature+🚀
        cases: [{ id: case, verify: [unit] }]
`).value!;
    expect(
      validateJapaneseView(
        "[foo#bar](target)",
        "[foo](target)",
        "specifications",
        punctuationManifest,
      ),
    ).toContain("specifications: protected Markdown idLinks changed");
  });

  it("preserves exact ID labels in reference-style links", () => {
    const source = "See [REQ-001][req].\n\n[req]: some-target\n";
    expect(
      validateJapaneseView(
        source,
        source.replace("See", "参照"),
        "specifications",
        manifest,
      ),
    ).toEqual([]);
    expect(
      validateJapaneseView(
        source,
        source.replace("[REQ-001]", "[変更]"),
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown idLinks changed");
    expect(
      validateJapaneseView(
        source,
        source.replace("some-target", "other"),
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown references changed");
  });

  it("preserves inline paths, URLs, and image destinations", () => {
    const source =
      "Run `moura validate .` on `docs/req.md`. Visit <https://example.com/docs> and ![diagram](diagram.png).";
    for (const [before, after, category] of [
      ["moura validate .", "moura check .", "code"],
      ["docs/req.md", "docs/other.md", "code"],
      ["https://example.com/docs", "https://example.com/other", "links"],
      ["diagram.png", "other.png", "links"],
    ]) {
      expect(
        validateJapaneseView(
          source,
          source.replace(before!, after!),
          "specifications",
          manifest,
        ),
      ).toContain(`specifications: protected Markdown ${category} changed`);
    }
  });

  it("rejects moving protected inline nodes between prose blocks", () => {
    for (const protectedText of [
      "`moura validate .`",
      "`docs/req.md`",
      "[details](some-target)",
      "![diagram](diagram.png)",
      '<span data-id="fixed"></span>',
      "[REQ-001](target)",
    ]) {
      const source = `First ${protectedText}.\n\nSecond.`;
      const moved = `First.\n\nSecond ${protectedText}.`;
      expect(
        validateJapaneseView(source, moved, "specifications", manifest),
      ).toContain("specifications: protected Markdown placements changed");
    }
    const referenceSource =
      "First [details][ref].\n\nSecond.\n\n[ref]: target\n";
    const referenceMoved =
      "First.\n\nSecond [details][ref].\n\n[ref]: target\n";
    expect(
      validateJapaneseView(
        referenceSource,
        referenceMoved,
        "specifications",
        manifest,
      ),
    ).toContain("specifications: protected Markdown placements changed");
  });

  it("rejects moving a protected command to another Case", () => {
    const source =
      "## REQ-001\n### feature+🚀\n#### CASE-001\n\nRun `moura validate .`.\n\n## REQ-002\n### SCN-002\n#### CASE-002\n\nOther guidance.";
    const moved =
      "## REQ-001\n### feature+🚀\n#### CASE-001\n\nRun.\n\n## REQ-002\n### SCN-002\n#### CASE-002\n\nOther guidance `moura validate .`.";
    expect(
      validateJapaneseView(source, moved, "specifications", orderedManifest),
    ).toContain("specifications: protected Markdown placements changed");
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
