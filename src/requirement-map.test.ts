import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it as vitestIt } from "vitest";

import { checkVerification } from "./check.js";
import { aggregateCoverageHierarchy, summarizeCoverage } from "./coverage.js";
import { parseManifest } from "./manifest.js";
import {
  locateRequirementMarkdown,
  locateSpecificationMarkdown,
} from "./markdown.js";
import type { Evidence } from "./model.js";
import { reportLocaleScript } from "./report-locale.js";
import {
  renderCoverageReport,
  reportProjectDirectory,
  requirementSourceFilename,
  withRequirementMapTranslation,
} from "./report.js";
import { mouraEvidenceTest } from "./test-support/moura-evidence.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-009/SCN-001/CASE-001"], "unit");
const statusIt = mouraEvidenceTest(
  vitestIt,
  ["REQ-009/SCN-001/CASE-002"],
  "unit",
);
const localeIt = mouraEvidenceTest(
  vitestIt,
  ["REQ-009/SCN-001/CASE-003"],
  "unit",
);
const integrationIt = mouraEvidenceTest(
  vitestIt,
  ["REQ-009/SCN-001/CASE-001"],
  "integration",
);

const yaml = `version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit, integration, future] }
requirements:
  - id: REQ-001
    scenarios:
      - id: SCN-001
        cases: [{ id: CASE-001, verify: [unit, integration] }]
      - id: SCN-002
        cases: [{ id: CASE-001, verify: [unit] }]
  - id: REQ-002
    scenarios:
      - id: SCN-001
        cases: [{ id: CASE-001, verify: [unit], unimplemented: [future] }]
`;
const manifest = parseManifest(yaml).value!;
const req =
  '## REQ-001 Validate <structure> & "titles" ###\n## REQ-002 Check warnings\n';
const spec =
  "## REQ-001\n### SCN-001 Validate a definition\n#### CASE-001 Accept a valid definition\n### SCN-002 Reject invalid input\n#### CASE-001 Reject safely\n## REQ-002\n### SCN-001 Handle future verification\n#### CASE-001 Track unimplemented work\n";
const reqLocations = locateRequirementMarkdown(req, "req.md", manifest);
const specLocations = locateSpecificationMarkdown(spec, "spec.md", manifest);
const evidence: Evidence[] = [
  {
    covers: ["REQ-001/SCN-001/CASE-001"],
    layer: "unit",
    status: "passed",
    source: "allure-results/<unit>&.json",
  },
  {
    covers: ["REQ-001/SCN-001/CASE-001"],
    layer: "integration",
    status: "passed",
  },
  { covers: ["REQ-001/SCN-002/CASE-001"], layer: "unit", status: "passed" },
  { covers: ["REQ-002/SCN-001/CASE-001"], layer: "unit", status: "skipped" },
];
const render = (items = evidence) =>
  renderCoverageReport(
    manifest,
    checkVerification(manifest, items),
    [],
    [],
    reqLocations,
    specLocations,
    items,
  );

describe("Requirement Map", () => {
  it("uses canonical Markdown titles, scoped hierarchy and existing source anchors", () => {
    const html = render();
    expect(reqLocations.get("REQ-001")?.title).toBe(
      'Validate <structure> & "titles"',
    );
    expect(html).toContain(
      '>Validate &lt;structure&gt; &amp; &quot;titles&quot;</span><span class="node-id">REQ-001</span>',
    );
    expect(html).toContain(
      'data-map-title="REQ-001/SCN-001" data-map-source="spec.md">Validate a definition</span>',
    );
    expect(html).toContain(
      'data-map-title="REQ-001/SCN-001/CASE-001" data-map-source="spec.md">Accept a valid definition</span>',
    );
    expect(html).toContain(
      'data-map-title="REQ-001/SCN-002/CASE-001" data-map-source="spec.md">Reject safely</span>',
    );
    expect(html).toContain(
      `href="./sources/${requirementSourceFilename("spec.md")}#${specLocations.get("REQ-001/SCN-002/CASE-001")!.anchor}"`,
    );
    const map = html
      .split('<div class="requirement-map">')[1]!
      .split('<h2 data-ja="逆方向')[0]!;
    expect(map.match(/class="requirement map-node"/gu)).toHaveLength(2);
    expect(map.match(/class="scenario map-node"/gu)).toHaveLength(3);
    expect(map.match(/class="case map-node"/gu)).toHaveLength(3);
    expect(map.indexOf('data-map-title="REQ-001/SCN-002"')).toBeLessThan(
      map.indexOf('data-map-title="REQ-002"'),
    );
    expect(map).toContain(
      'class="requirement map-node" data-severity="success"><summary>',
    );
    expect(map).toContain(
      'class="requirement map-node" data-severity="warning" open>',
    );
    expect(map).not.toContain(
      'class="case map-node" data-severity="success" open',
    );
  });

  it("retains exact pairs, collapsed Evidence, summary, per-layer coverage and successful diagnostics", () => {
    const html = render();
    expect(html).toContain(
      '<div class="case-details"><h4 data-ja="組み合わせのステータス">Pair statuses</h4>',
    );
    expect(html).toContain("allure-results/&lt;unit&gt;&amp;.json");
    expect(html).not.toContain("allure-results/<unit>");
    expect(html).toContain("<span>passed</span>");
    expect(html).toContain("<span>SKIPPED</span>");
    expect(html).toContain("<span>UNIMPLEMENTED</span>");
    expect(html).toContain(
      "Required verification layers</span>: unit, integration",
    );
    expect(html).toContain("2 / 3 (67%)");
    expect(html).toContain("Per-layer coverage");
    expect(html.match(/✓ No issues found<\/p>/gu)).toHaveLength(2);
    expect(render([])).toContain("No Evidence available");
  });

  it("ships desktop wrapping columns, mobile single columns and accessible status and expansion styles", () => {
    const html = render();
    expect(html).toContain(
      ".scenario-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))",
    );
    expect(html).toMatch(
      /@media\(max-width:40rem\).*\.scenario-grid\{grid-template-columns:minmax\(0,1fr\)\}/u,
    );
    expect(html).toContain("min-height:44px");
    expect(html).toContain("summary:focus-visible");
    expect(html).toContain("overflow-wrap:anywhere");
    for (const severity of ["success", "warning", "error"])
      expect(html).toContain(
        `.map-node[data-severity=${severity}]{background:`,
      );
    expect(html).toContain('<span aria-hidden="true">✓</span>');
    expect(html).toContain('<span aria-hidden="true">!</span>');
    expect(html).toContain('<span data-ja="未完了">INCOMPLETE</span>');
  });

  statusIt.each(["passed", "skipped", "failed", "broken", "missing"] as const)(
    "propagates %s pair results through Case, Scenario and Requirement without changing Check semantics",
    (status) => {
      const items = evidence.filter(
        (item) => item.covers[0] !== "REQ-001/SCN-001/CASE-001",
      );
      if (status !== "missing")
        items.push(
          { covers: ["REQ-001/SCN-001/CASE-001"], layer: "unit", status },
          {
            covers: ["REQ-001/SCN-001/CASE-001"],
            layer: "integration",
            status: "passed",
          },
        );
      const check = checkVerification(manifest, items);
      const expected =
        status === "passed"
          ? "PASS"
          : status === "skipped"
            ? "INCOMPLETE"
            : "FAIL";
      const severity =
        status === "passed"
          ? "success"
          : status === "skipped"
            ? "warning"
            : "error";
      const hierarchy = aggregateCoverageHierarchy(manifest, check);
      for (const id of [
        "REQ-001",
        "REQ-001/SCN-001",
        "REQ-001/SCN-001/CASE-001",
      ])
        expect(hierarchy.get(id)).toMatchObject({ status: expected, severity });
      expect(summarizeCoverage(manifest, check).requirements.covered).toBe(
        status === "passed" ? 1 : 0,
      );
      const html = render(items);
      expect(html).toContain(
        `class="requirement map-node" data-severity="${severity}"${status === "passed" ? "" : " open"}>`,
      );
      expect(html).toContain(
        `class="scenario map-node" data-severity="${severity}"`,
      );
      expect(html).toContain(
        `class="case map-node" data-severity="${severity}"`,
      );
      const exact =
        status === "passed"
          ? "PASS"
          : status === "skipped"
            ? "SKIPPED"
            : status === "failed"
              ? "FAIL"
              : status === "broken"
                ? "BROKEN"
                : "MISSING";
      expect(html).toContain(
        `class="status badge ${exact.toLowerCase()}" data-severity="${severity}"`,
      );
      if (severity === "error")
        expect(html).toContain('<span aria-hidden="true">×</span>');
    },
  );

  statusIt(
    "rejects omitted required Check pairs instead of reporting a false PASS",
    () => {
      const check = checkVerification(manifest, evidence);
      expect(() =>
        aggregateCoverageHierarchy(manifest, {
          ...check,
          entries: check.entries.slice(1),
        }),
      ).toThrow("Check result omitted required pair");
    },
  );

  it("gets titles only from document-level scoped declarations, ignoring nested and fenced headings", () => {
    const locations = locateSpecificationMarkdown(
      spec + "\n> ### SCN-001 Bad\n\n```md\n#### CASE-001 Bad\n```\n",
      "spec.md",
      manifest,
    );
    expect(locations).toEqual(specLocations);
    expect(
      locateRequirementMarkdown("## REQ-001\n", "req.md", manifest).get(
        "REQ-001",
      )?.title,
    ).toBe("");
    expect(
      renderCoverageReport(manifest, checkVerification(manifest, evidence)),
    ).toContain('data-map-title="REQ-001" data-map-source="">REQ-001</span>');
  });

  localeIt.each(["en", "ja"] as const)(
    "uses existing locale script for %s titles, fallback and source links",
    (locale) => {
      const translated = new Map([
        ...locateRequirementMarkdown(
          "## REQ-001 構造を検証する\n## REQ-002 警告を確認する\n",
          "req.md",
          manifest,
        ),
        ...[
          ...locateSpecificationMarkdown(
            "## REQ-001\n### SCN-001 定義を検証する\n#### CASE-001 有効な定義を受理する\n",
            "spec.md",
            manifest,
          ),
        ].filter(([id]) => id.includes("/")),
      ]);
      const html = withRequirementMapTranslation(render(), translated);
      const elements = [
        ...html.matchAll(
          /<span class="node-title" data-map-title="([^"]*)" data-map-source="[^"]*"(?: data-ja="([^"]*)")?>([^<]*)<\/span>/gu,
        ),
      ].map(([, id, ja, en]) => ({
        id,
        dataset: ja ? { ja } : {},
        textContent: en,
      }));
      const link = {
        href: "./sources/source.html#requirement-52",
        getAttribute() {
          return this.href;
        },
        setAttribute(_name: string, value: string) {
          this.href = value;
        },
      };
      runInNewContext(reportLocaleScript, {
        URL,
        location: {
          href: `https://example.com/index.html?lang=${locale}`,
          hash: "",
        },
        document: {
          documentElement: { lang: "en" },
          querySelector: () => null,
          querySelectorAll: (selector: string) =>
            selector === "[data-ja]"
              ? elements.filter((element) => element.dataset.ja)
              : selector === "a[href]"
                ? [link]
                : [],
        },
      });
      expect(
        elements.find((element) => element.id === "REQ-001")?.textContent,
      ).toBe(
        locale === "ja"
          ? "構造を検証する"
          : "Validate &lt;structure&gt; &amp; &quot;titles&quot;",
      );
      expect(
        elements.find((element) => element.id === "REQ-001/SCN-001")
          ?.textContent,
      ).toBe(locale === "ja" ? "定義を検証する" : "Validate a definition");
      expect(
        elements.find((element) => element.id === "REQ-001/SCN-001/CASE-001")
          ?.textContent,
      ).toBe(
        locale === "ja" ? "有効な定義を受理する" : "Accept a valid definition",
      );
      expect(
        elements.find((element) => element.id === "REQ-001/SCN-002/CASE-001")
          ?.textContent,
      ).toBe("Reject safely");
      expect(link.href).toBe(
        `./sources/source.html?lang=${locale}#requirement-52`,
      );
      expect(withRequirementMapTranslation(render(), new Map())).toBe(render());
    },
  );

  localeIt(
    "escapes translated titles, ignores unrelated sources and preserves canonical content",
    () => {
      const translations = new Map([
        [
          "REQ-001",
          {
            source: "req.md",
            line: 1,
            anchor: "unused",
            title: '<script>alert("x")</script> & 日本語',
          },
        ],
        [
          "REQ-001/SCN-001",
          {
            source: "other.md",
            line: 1,
            anchor: "unused",
            title: "wrong source",
          },
        ],
      ]);
      const html = withRequirementMapTranslation(render(), translations);
      expect(html).toContain(
        'data-ja="&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; 日本語"',
      );
      expect(html).not.toContain("wrong source");
      expect(html).not.toContain('<script>alert("x")</script>');
      expect(html).toContain(
        ">Validate &lt;structure&gt; &amp; &quot;titles&quot;</span>",
      );
    },
  );

  integrationIt(
    "generates canonical Map titles and normalized Evidence through the project report boundary",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "moura-map-"));
      try {
        await mkdir(join(root, "allure-results"));
        await writeFile(join(root, "moura.yaml"), yaml);
        await writeFile(join(root, "req.md"), req);
        await writeFile(join(root, "spec.md"), spec);
        const result = await reportProjectDirectory(root, {
          loadEvidence: async () => ({ evidence, issues: [] }),
        });
        expect(result.exitCode).toBe(0);
        const html = await readFile(result.outputPath!, "utf8");
        expect(html).toContain("Validate &lt;structure&gt;");
        expect(html).toContain("Accept a valid definition");
        expect(html).toContain("allure-results/&lt;unit&gt;&amp;.json");
        expect(html).toContain(
          'class="requirement map-node" data-severity="warning" open',
        );
        const source = await readFile(
          join(
            root,
            "moura-report/sources",
            requirementSourceFilename("spec.md"),
          ),
          "utf8",
        );
        expect(source).toContain(
          `id="${specLocations.get("REQ-001/SCN-001/CASE-001")!.anchor}"`,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
