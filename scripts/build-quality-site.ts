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

import { isDirectExecution } from "./direct-execution.js";
import { readJapaneseViews } from "./fetch-japanese-views.js";

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
  writeFileSync(
    path("_site/index.html"),
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="format-detection" content="telephone=no"><title>Moura Quality Reports</title>
<style>body{font:16px system-ui,sans-serif;line-height:1.5;max-width:72rem;margin:auto;padding:2rem;color:#172033}h1,h2{line-height:1.2}.intro{margin-bottom:2rem}.reports{display:grid;gap:1rem}.report{display:block;border:1px solid #ccd3df;border-radius:.5rem;padding:1.25rem;color:inherit;text-decoration:none}.report:first-child{border-color:#167044;border-width:2px}.report h2{margin:0 0 .35rem;font-size:1.2rem}.report p{margin:.35rem 0;color:#4b5565}.open{font-weight:700;color:#167044}.meta{margin-top:2rem;font-size:.9rem}.meta p{margin:.25rem 0}.meta a{color:#167044}@media(max-width:40rem){body{padding:1rem}.intro{margin-bottom:1.5rem}}</style></head>
<body><main><h1>Moura Quality Reports</h1><p class="intro">Quality reports generated from Moura's own CI.</p><div class="reports">
<a class="report" href="./moura/"><h2>Requirement Coverage</h2><p>Declared traceability and verification status</p><span class="open">Open →</span></a>
<a class="report" href="./allure/"><h2>Allure Report</h2><p>Test execution details</p><span class="open">Open →</span></a>
<a class="report" href="./coverage/"><h2>Code Coverage</h2><p>Source code coverage</p><span class="open">Open →</span></a>
</div><footer class="meta"><p>Source: <a href="https://github.com/specxai/moura">specxai/moura</a></p><p>Commit: <code>${sha}</code></p></footer></main></body></html>\n`,
  );
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
