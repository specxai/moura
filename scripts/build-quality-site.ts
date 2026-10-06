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
  requirementSourceFilename,
} from "../src/report.js";
import { withReportLocale } from "../src/report-locale.js";

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
  cpSync(path("moura-report"), path("_site/moura"), { recursive: true });
  const japanese = await readJapaneseViews(root);
  if (japanese.views) {
    const manifest = parseManifest(
      readFileSync(path("moura.yaml"), "utf8"),
    ).value!;
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
  } else {
    console.log(japanese.messages.join("\n"));
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `\nJapanese presentation unavailable; using canonical English content.\n\n\`\`\`text\n${japanese.messages.join("\n").replaceAll("`", "'")}\n\`\`\`\n`,
      );
  }
  const sha = escapeHtml(process.env.GITHUB_SHA?.slice(0, 7) ?? "local build");
  const overview = await collectQualityOverview(root);
  writeFileSync(path("_site/index.html"), renderOverview(overview, sha));
}

export function renderOverview(overview: QualityOverview, sha: string): string {
  const requirement = overview.requirementCoverage;
  const requirementValue = requirement
    ? `${requirement.covered} / ${requirement.total}`
    : "Unavailable";
  const requirementPercent = requirement
    ? `${percent(requirement.covered, requirement.total)}%`
    : "—";
  const missing = overview.missingEvidence ?? "Unavailable";
  const tests = overview.testResults;
  const lines = overview.codeCoverageLines;
  return withReportLocale(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="format-detection" content="telephone=no"><title>Moura Quality Reports</title>
<style>:root{color-scheme:light}body{font:16px system-ui,sans-serif;line-height:1.5;max-width:72rem;margin:auto;padding:2rem;color:#172033;background:#fff}h1,h2{line-height:1.2}.intro{margin-bottom:2rem;color:#4b5565}.status-card,.metric,.report{border:1px solid #ccd3df;border-radius:.65rem;padding:1.25rem}.status-card{border-width:2px;margin-bottom:1rem}.status-card[data-status=PASS]{border-color:#167044}.status-card[data-status=INCOMPLETE]{border-color:#a15c00}.status-card[data-status=FAIL]{border-color:#b42318}.eyebrow{display:block;font-weight:700;color:#4b5565}.overall{display:block;font-size:2rem;font-weight:800}.overall.PASS{color:#167044}.overall.INCOMPLETE{color:#854d0e}.overall.FAIL{color:#b42318}.primary,.secondary,.reports{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin:1rem 0}.metric{color:inherit;text-decoration:none}.metric h2,.report h2{margin:0 0 .5rem;font-size:1.15rem}.value{display:block;font-size:1.8rem;font-weight:750}.subvalue{color:#4b5565}.results{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}.results span{display:block}.results strong{font-size:1.35rem}.details{margin-top:2rem}.report{display:block;color:inherit;text-decoration:none}.report p{margin:.35rem 0;color:#4b5565}.open{font-weight:700;color:#167044}.meta{margin-top:2rem;font-size:.9rem}.meta p{margin:.25rem 0}.meta a,.metric:hover,.metric:focus,.report:hover,.report:focus{color:#167044}@media(max-width:40rem){body{padding:1rem}.intro{margin-bottom:1.5rem}.primary,.secondary,.reports{grid-template-columns:1fr}}</style></head>
<body><main><h1>Moura Quality Reports</h1><p class="intro">Verification completeness against project requirements.</p>
<section class="status-card" data-status="${overview.status}"><span class="eyebrow">Overall Status</span><strong class="overall ${overview.status}">${overview.status}</strong><span>Required verification and its Evidence determine this status.</span></section>
<div class="primary"><a class="metric" href="./moura/"><h2>Requirement Coverage</h2><strong class="value">${requirementValue}</strong><span class="subvalue">${requirementPercent}</span></a>
<a class="metric" href="./moura/"><h2>Missing Evidence</h2><strong class="value">${missing}</strong><span class="subvalue">View verification gaps →</span></a></div>
<div class="secondary"><a class="metric" href="./allure/"><h2>Test Results</h2><div class="results"><span><span>Passed</span><strong>${tests?.passed ?? "—"}</strong></span><span><span>Failed</span><strong>${tests ? tests.failed + tests.broken : "—"}</strong></span><span><span>Skipped</span><strong>${tests?.skipped ?? "—"}</strong></span></div></a>
<a class="metric" href="./coverage/"><h2>Code Coverage</h2><span>Lines</span><strong class="value">${lines === undefined ? "—" : `${lines}%`}</strong></a></div>
<section class="details"><h2>Detailed Reports</h2><div class="reports">
<a class="report" href="./moura/"><h2>Requirement Coverage</h2><p>Declared traceability and verification status</p><span class="open">Open →</span></a>
<a class="report" href="./allure/"><h2>Allure Report</h2><p>Test execution details</p><span class="open">Open →</span></a>
<a class="report" href="./coverage/"><h2>Code Coverage</h2><p>Source code coverage</p><span class="open">Open →</span></a>
</div></section><footer class="meta"><p><span>Source:</span> <a href="https://github.com/specxai/moura">specxai/moura</a></p><p><span>Commit:</span> <code>${sha}</code></p></footer></main></body></html>\n`);
}

function percent(covered: number, total: number): number {
  return total === 0 ? 100 : Math.round((covered / total) * 100);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (isDirectExecution(import.meta.url))
  buildQualitySite().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
