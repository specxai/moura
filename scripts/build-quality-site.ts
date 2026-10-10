import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import process from "node:process";
import { resolve } from "node:path";
import { appendFile } from "node:fs/promises";

import { parseManifest } from "../src/manifest.js";
import {
  locateRequirementMarkdown,
  locateSpecificationMarkdown,
} from "../src/markdown.js";
import {
  renderRequirementSource,
  withRequirementMapTranslation,
  requirementSourceFilename,
} from "../src/report.js";
import { renderOverview as renderSharedOverview } from "../src/overview-report.js";

import { isDirectExecution } from "./direct-execution.js";
import { readJapaneseViews } from "./fetch-japanese-views.js";
import {
  collectQualityOverview,
  type QualityOverview,
} from "./quality-overview.js";

export async function buildQualitySite(root = "."): Promise<void> {
  const path = (entry: string) => resolve(root, entry);

  for (const entry of [
    "moura-report/index.html",
    "allure-report/index.html",
    "coverage/index.html",
  ]) {
    readFileSync(path(entry));
  }
  rmSync(path("_site"), { recursive: true, force: true });
  mkdirSync(path("_site"), { recursive: true });
  cpSync(path("coverage"), path("_site/coverage"), { recursive: true });
  cpSync(path("allure-report"), path("_site/allure"), { recursive: true });
  cpSync(
    path(
      existsSync(path("moura-report/moura/index.html"))
        ? "moura-report/moura"
        : "moura-report",
    ),
    path("_site/moura"),
    { recursive: true },
  );
  const japanese = await readJapaneseViews(root);
  if (japanese.views) {
    const manifest = parseManifest(
      readFileSync(path("moura.yaml"), "utf8"),
    ).value!;
    const mapLocations = new Map();
    for (const [source, role, locate] of [
      ["req.md", "requirements", locateRequirementMarkdown],
      ["spec.md", "specifications", locateSpecificationMarkdown],
    ] as const) {
      const destination = path(
        `_site/moura/sources/${requirementSourceFilename(source)}`,
      );
      // Only enrich bundled canonical sources, never create a translation-only ID.
      if (!existsSync(destination)) continue;
      const canonical = readFileSync(path(source), "utf8");
      for (const [id, location] of locate(
        japanese.views[role],
        source,
        manifest,
      ))
        if (role === "requirements" || id.includes("/"))
          mapLocations.set(id, location);
      writeFileSync(
        destination,
        renderRequirementSource(
          source,
          canonical,
          locate(canonical, source, manifest),
          {
            markdown: japanese.views[role],
            locations: locate(japanese.views[role], source, manifest),
          },
        ),
      );
    }
    const reportPath = path("_site/moura/index.html");
    writeFileSync(
      reportPath,
      withRequirementMapTranslation(
        readFileSync(reportPath, "utf8"),
        mapLocations,
      ),
    );
  } else {
    console.log(japanese.messages.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `\nJapanese presentation unavailable; using canonical English content.\n\n\`\`\`text\n${japanese.messages.join("\n").replaceAll("`", "'")}\n\`\`\`\n`,
      );
  }
  const sha = process.env.GITHUB_SHA?.slice(0, 7) ?? "local build";
  const overview = await collectQualityOverview(root);
  writeFileSync(path("_site/index.html"), renderOverview(overview, sha));
}

export function renderOverview(overview: QualityOverview, sha: string): string {
  return renderSharedOverview(overview, sha, {
    requirementMap: "./moura/",
    allure: "./allure/",
    coverage: "./coverage/",
    source: { url: "https://github.com/specxai/moura", label: "specxai/moura" },
  });
}

if (isDirectExecution(import.meta.url))
  buildQualitySite().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
