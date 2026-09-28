import { describe, expect, it } from "vitest";

import { parseManifest } from "../src/manifest.js";
import { validateJapaneseView } from "./validate-japanese-views.js";

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
      - id: SCN-001
        cases:
          - { id: CASE-001, verify: [unit] }
`).value!;

const canonical = `# Specification

## REQ-001 Read a file

### SCN-001 Validate input

#### CASE-001 Keep machine values

Run \`moura validate .\` against [the manifest](moura.yaml).

\`\`\`yaml
version: 1
\`\`\`
`;

const translated = `# 仕様

## REQ-001 ファイルを読む

### SCN-001 入力を検証する

#### CASE-001 機械可読値を維持する

\`moura validate .\` を実行し、[マニフェスト](moura.yaml)を検証する。

\`\`\`yaml
version: 1
\`\`\`
`;

describe("Japanese view integrity", () => {
  it("allows human-readable prose to differ", () => {
    expect(
      validateJapaneseView(canonical, translated, "specifications", manifest),
    ).toEqual([]);
  });

  it("detects traceability identifier and hierarchy drift", () => {
    const changedId = translated.replace("CASE-001", "CASE-002");
    const changedHierarchy = translated.replace("### SCN-001", "# SCN-001");
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
});
