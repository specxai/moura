import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import { reportLocaleScript } from "./report-locale.js";

// Exercise the shipped inline script's DOM boundary, without a browser dependency.
function openPage(
  query: string,
  detail = false,
  translated = false,
  protocol = "https:",
) {
  const source = detail ? { innerHTML: "English canonical" } : null;
  const translation = translated ? { innerHTML: "日本語訳" } : null;
  const fallback = { hidden: true };
  const heading = {
    textContent: "Requirement Coverage",
    dataset: { ja: "要求カバレッジ" },
  };
  const link = (href: string, language?: string) => ({
    href,
    dataset: { language },
    attributes: new Map<string, string>(),
    getAttribute: () => href,
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
      if (name === "href") this.href = value;
    },
  });
  const links = [
    link("./sources/source.html#requirement-52"),
    link("../index.html?other=1#summary"),
    link("https://github.com/specxai/moura"),
  ];
  const languages = [link("?lang=ja", "ja"), link("?lang=en", "en")];
  let scrolled = false;
  const document = {
    documentElement: { lang: "en" },
    querySelector(selector: string) {
      return selector === "[data-source-content]"
        ? source
        : selector === "template[data-translation]"
          ? translation
          : fallback;
    },
    querySelectorAll(selector: string) {
      return selector === "[data-ja]"
        ? [heading]
        : selector === "a[href]"
          ? links
          : languages;
    },
    getElementById(id: string) {
      return id === "requirement-52"
        ? {
            scrollIntoView() {
              scrolled = true;
            },
          }
        : null;
    },
  };
  const href = `${protocol}//${protocol === "file:" ? "/tmp" : "example.com"}/report/index.html${query}#requirement-52`;
  runInNewContext(reportLocaleScript, {
    document,
    location: { href, hash: "#requirement-52" },
    URL,
  });
  return { document, heading, links, languages, source, fallback, scrolled };
}

describe("report language navigation", () => {
  it.each(["https:", "file:"])(
    "carries Japanese through source and return links on %s",
    (protocol) => {
      const page = openPage("?lang=ja&other=1", false, false, protocol);
      expect(page.document.documentElement.lang).toBe("ja");
      expect(page.heading.textContent).toBe("要求カバレッジ");
      expect(page.links[0]!.href).toBe(
        "./sources/source.html?lang=ja#requirement-52",
      );
      expect(page.links[1]!.href).toBe("../index.html?other=1&lang=ja#summary");
      expect(page.links[2]!.href).toBe("https://github.com/specxai/moura");
      const english = new URL(page.languages[1]!.href);
      expect(english.searchParams.get("lang")).toBe("en");
      expect(english.searchParams.get("other")).toBe("1");
      expect(english.hash).toBe("#requirement-52");
      expect(page.languages[0]!.attributes.get("aria-current")).toBe("true");
    },
  );

  it("displays the translation and restores the current canonical anchor", () => {
    const page = openPage("?lang=ja", true, true);
    expect(page.source!.innerHTML).toBe("日本語訳");
    expect(page.document.documentElement.lang).toBe("ja");
    expect(page.fallback.hidden).toBe(true);
    expect(page.scrolled).toBe(true);
  });

  it("falls back to English without losing the preferred language on return", () => {
    const page = openPage("?lang=ja", true);
    expect(page.source!.innerHTML).toBe("English canonical");
    expect(page.document.documentElement.lang).toBe("en");
    expect(page.fallback.hidden).toBe(false);
    expect(page.links[1]!.href).toContain("lang=ja");
  });

  it.each(["", "?lang=en", "?lang=unsupported"])(
    "uses English canonical content for %s",
    (query) => {
      const page = openPage(query, true, true);
      expect(page.source!.innerHTML).toBe("English canonical");
      expect(page.heading.textContent).toBe("Requirement Coverage");
      expect(page.document.documentElement.lang).toBe("en");
      expect(page.links[0]!.href).toContain("lang=en");
      expect(page.fallback.hidden).toBe(true);
    },
  );
});

// Reused local IDs must point at distinct scoped anchors in both documents.
it("keeps Spec identity scoped and anchors independent of translated line offsets", async () => {
  const { parseManifest } = await import("./manifest.js");
  const { locateSpecificationMarkdown } = await import("./markdown.js");
  const { renderRequirementSource } = await import("./report.js");
  const manifest = parseManifest(`version: 1
sources: { requirements: [req.md], specifications: [spec.md] }
verification: { layers: [unit] }
requirements:
  - id: A
    scenarios: [{ id: S, cases: [{ id: C, verify: [unit] }] }]
  - id: B
    scenarios: [{ id: S, cases: [{ id: C, verify: [unit] }] }]
`).value!;
  const english =
    "## A\n### S\n#### C English\n## B\n### S\n#### C English\n> #### C quoted content\n";
  const japanese =
    "日本語訳の説明\n\n" + english.replaceAll("English", "日本語");
  const en = locateSpecificationMarkdown(english, "spec.md", manifest);
  const ja = locateSpecificationMarkdown(japanese, "spec.md", manifest);
  expect([...en.keys()]).toEqual(["A", "A/S", "A/S/C", "B", "B/S", "B/S/C"]);
  expect(ja.get("A/S/C")!.anchor).toBe(en.get("A/S/C")!.anchor);
  expect(ja.get("A/S/C")!.line).toBe(en.get("A/S/C")!.line + 2);
  expect(en.get("A/S/C")!.anchor).not.toBe(en.get("B/S/C")!.anchor);
  const page = renderRequirementSource("spec.md", english, en, {
    markdown: japanese,
    locations: ja,
  });
  const translated = page
    .split("<template data-translation>")[1]!
    .split("</template>")[0]!;
  for (const location of en.values())
    expect(translated).toContain(`id="${location.anchor}"`);
  expect(translated).toContain("#### C 日本語</span>");
});
