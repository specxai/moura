import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import type { EvidenceAdapterIssue } from "./adapters/allure.js";
import type {
  VerificationCheckResult,
  VerificationProjectCheckResult,
} from "./check.js";
import { verificationSeverity } from "./check.js";
import type { CanonicalId } from "./id.js";
import {
  evaluateProjectDirectory,
  formatEvidenceAdapterIssue,
  formatEvidenceIssue,
  formatTraceabilityDiagnostic,
  type CheckCommandOptions,
} from "./check-command.js";
import {
  summarizeCoverage,
  aggregateCoverageHierarchy,
  type CoverageNodeStatus,
  coverageStatuses,
  type CoverageCount,
} from "./coverage.js";
import { canonicalId } from "./id.js";
import type { MouraManifest } from "./manifest.js";
import {
  locateRequirementMarkdown,
  locateSpecificationMarkdown,
  type RequirementSourceLocation,
} from "./markdown.js";
import { withReportLocale } from "./report-locale.js";
import type { Evidence, VerificationLayer } from "./model.js";
import { qualityOverviewFromEvaluation } from "./quality-overview.js";
import { renderOverview } from "./overview-report.js";
import { writeReportOutput } from "./report-output.js";
import { validateJapaneseView } from "./japanese-view.js";

export interface ReportCommandOptions extends CheckCommandOptions {
  readonly output?: string;
  /** Project-relative JSON mapping canonical source paths to Japanese view paths. */
  readonly japaneseViews?: string;
}

export interface ReportCommandOutput {
  readonly exitCode: 0 | 1;
  /** Requirement Map entry point, retained for API consumers. */
  readonly outputPath?: string;
  readonly overviewPath?: string;
  readonly errors: readonly string[];
}

export async function reportProjectDirectory(
  directory: string,
  options: ReportCommandOptions = {},
): Promise<ReportCommandOutput> {
  const evaluation = await evaluateProjectDirectory(directory, options);
  if (evaluation.kind === "invalid-project")
    return { exitCode: 1, errors: evaluation.errors };
  const specificationLocations = new Map<string, RequirementSourceLocation>();
  for (const [source, markdown] of evaluation.specificationSources)
    for (const [id, location] of locateSpecificationMarkdown(
      markdown,
      source,
      evaluation.manifest,
    ))
      specificationLocations.set(id, location);
  let outputPath: string;
  let overviewPath: string;
  try {
    const root = await realpath(resolve(directory));
    const sources = new Map([
      ...evaluation.requirementSources,
      ...evaluation.specificationSources,
    ]);
    const locations = new Map(
      [
        ...specificationLocations.values(),
        ...evaluation.requirementLocations.values(),
      ].map((location, index) => [String(index), location]),
    );
    const translations = new Map<string, string>();
    const translationInputs: string[] = [];
    if (options.japaneseViews) {
      const configPath = resolve(root, options.japaneseViews);
      translationInputs.push(configPath);
      const mapping: unknown = JSON.parse(await readFile(configPath, "utf8"));
      if (
        typeof mapping !== "object" ||
        mapping === null ||
        Array.isArray(mapping)
      )
        throw new Error(
          "Japanese views must be a JSON object mapping canonical source paths to translated file paths",
        );
      for (const [source, path] of Object.entries(mapping)) {
        if (!sources.has(source) || typeof path !== "string")
          throw new Error(
            `Unknown Japanese view source or invalid path: ${source}`,
          );
        const translatedPath = resolve(root, path);
        translationInputs.push(translatedPath);
        const translated = await readFile(translatedPath, "utf8");
        const role = evaluation.requirementSources.has(source)
          ? "requirements"
          : "specifications";
        const problems = validateJapaneseView(
          sources.get(source)!,
          translated,
          role,
          evaluation.manifest,
        );
        if (problems.length)
          throw new Error(
            `Invalid Japanese view ${source}: ${problems.join("; ")}`,
          );
        translations.set(source, translated);
      }
    }
    let map = renderCoverageReport(
      evaluation.manifest,
      evaluation.check,
      evaluation.adapterIssues,
      evaluation.traceabilityDiagnostics,
      evaluation.requirementLocations,
      specificationLocations,
      evaluation.evidence,
    );
    const translatedLocations = new Map<string, RequirementSourceLocation>();
    const files = new Map<string, string>();
    for (const [source, markdown] of sources) {
      const translated = translations.get(source);
      const locate = evaluation.requirementSources.has(source)
        ? locateRequirementMarkdown
        : locateSpecificationMarkdown;
      const japaneseLocations =
        translated === undefined
          ? undefined
          : locate(translated, source, evaluation.manifest);
      if (japaneseLocations)
        for (const [id, location] of japaneseLocations)
          if (evaluation.requirementSources.has(source) || id.includes("/"))
            translatedLocations.set(id, location);
      files.set(
        `moura/sources/${requirementSourceFilename(source)}`,
        renderRequirementSource(
          source,
          markdown,
          locations,
          translated === undefined
            ? undefined
            : { markdown: translated, locations: japaneseLocations! },
        ),
      );
    }
    if (translations.size)
      map = withRequirementMapTranslation(map, translatedLocations);
    map = map.replace(
      "<main>",
      '<main><a href="../index.html" data-ja="← 品質概要">← Quality Overview</a>',
    );
    files.set("moura/index.html", map);
    files.set(
      "index.html",
      renderOverview(await qualityOverviewFromEvaluation(root, evaluation)),
    );
    const output = await writeReportOutput(
      root,
      options.output ?? "moura-report",
      ["moura.yaml", ...sources.keys(), ...translationInputs],
      files,
    );
    overviewPath = resolve(output, "index.html");
    outputPath = resolve(output, "moura/index.html");
  } catch (error) {
    return {
      exitCode: 1,
      errors: [
        `Could not write Requirement Coverage report: ${errorMessage(error)}`,
      ],
    };
  }
  const semanticErrors =
    evaluation.check.evidenceIssues.map(formatEvidenceIssue);
  return {
    exitCode:
      evaluation.adapterIssues.length === 0 &&
      evaluation.check.evidenceIssues.length === 0 &&
      evaluation.traceabilityDiagnostics.every(
        (diagnostic) => diagnostic.severity !== "error",
      )
        ? 0
        : 1,
    outputPath,
    overviewPath,
    errors: [
      ...evaluation.adapterIssues.map(formatEvidenceAdapterIssue),
      ...semanticErrors,
      ...evaluation.traceabilityDiagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map(formatTraceabilityDiagnostic),
    ],
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function renderCoverageReport(
  manifest: MouraManifest,
  check: VerificationProjectCheckResult,
  adapterIssues: readonly EvidenceAdapterIssue[] = [],
  traceabilityDiagnostics: readonly import("./check-command.js").TraceabilityDiagnostic[] = [],
  requirementLocations: ReadonlyMap<
    string,
    RequirementSourceLocation
  > = new Map(),
  specificationLocations: ReadonlyMap<
    string,
    RequirementSourceLocation
  > = new Map(),
  evidence: readonly Evidence[] = [],
): string {
  const summary = summarizeCoverage(manifest, check);
  const nodeStatuses = aggregateCoverageHierarchy(manifest, check);
  const entries = new Map<
    CanonicalId,
    Map<VerificationLayer, VerificationCheckResult>
  >();
  for (const entry of check.entries) {
    const layers = entries.get(entry.caseId) ?? new Map();
    layers.set(entry.layer, entry);
    entries.set(entry.caseId, layers);
  }
  const cards = (["requirements", "scenarios", "cases", "pairs"] as const)
    .map(
      (key) =>
        `<div class="metric"><strong>${title(key)}</strong><span>${count(summary[key])}</span></div>`,
    )
    .join("");
  const statusCounts = coverageStatuses
    .map(
      (status) =>
        `<li><span class="status ${status.toLowerCase()}" data-severity="${verificationSeverity(status)}">${status}</span> <span class="sr-only"> severity: ${verificationSeverity(status)}</span> ${check.entries.filter((entry) => entry.status === status).length}</li>`,
    )
    .join("");
  const layers = summary.layers
    .map(
      (layer) =>
        `<tr><th>${renderText(layer.layer)}</th><td>${count(layer)}</td></tr>`,
    )
    .join("");
  const hierarchy = manifest.requirements
    .map((requirement) => {
      const scenarios = requirement.scenarios
        .map((scenario) => {
          const cases = scenario.cases
            .map((testCase) => {
              const caseId = canonicalId([requirement, scenario, testCase]);
              const statuses = [
                ...testCase.verify,
                ...(testCase.unimplemented ?? []),
              ]
                .map((layer) => {
                  const entry = entries.get(caseId)?.get(layer);
                  if (!entry)
                    throw new Error(
                      `Check result omitted required pair ${caseId} × ${layer}`,
                    );
                  const { status, severity } = entry;
                  return `<li><code>${renderText(layer)}</code> ${pairBadge(status, severity)}</li>`;
                })
                .join("");
              const node = nodeStatuses.get(caseId)!;
              const matchingEvidence = evidence.filter((item) =>
                item.covers.includes(caseId),
              );
              const evidenceHtml =
                matchingEvidence.length === 0
                  ? "<p>No Evidence available</p>"
                  : `<ul class="evidence-list">${matchingEvidence.map(renderEvidence).join("")}</ul>`;
              return `<details class="case map-node" data-severity="${node.severity}"><summary aria-expanded="false"><h4>${sourceLink(caseId, specificationLocations)}</h4>${nodeBadge(node)}<span class="required-layers"><span>Required verification layers</span>: ${[...testCase.verify, ...(testCase.unimplemented ?? [])].map(renderText).join(", ")}</span><span class="chevron" aria-hidden="true"></span></summary><div class="case-details"><h4>Pair statuses</h4><ul>${statuses}</ul><h4>Evidence</h4>${evidenceHtml}</div></details>`;
            })
            .join("");
          const scenarioId = canonicalId([requirement, scenario]);
          const node = nodeStatuses.get(scenarioId)!;
          return `<section class="scenario map-node" data-severity="${node.severity}"><header><h3>${sourceLink(scenarioId, specificationLocations)}</h3>${nodeBadge(node)}</header><div class="cases">${cases}</div></section>`;
        })
        .join("");
      const requirementId = canonicalId([requirement]);
      const node = nodeStatuses.get(requirementId)!;
      const specification = specificationLocations.get(requirementId);
      return `<details class="requirement map-node" data-severity="${node.severity}"${node.status === "PASS" ? "" : " open"}><summary aria-expanded="${node.status === "PASS" ? "false" : "true"}"><h2>${sourceLink(requirementId, requirementLocations)}</h2>${nodeBadge(node)}<span class="chevron" aria-hidden="true"></span></summary><div class="requirement-content">${specification ? `<p><a href="${escapeHtml(requirementSourceHref(specification))}">Specification</a></p>` : ""}<div class="scenario-grid">${scenarios}</div></div></details>`;
    })
    .join("");
  const issues = [
    ...adapterIssues.map(formatEvidenceAdapterIssue),
    ...check.evidenceIssues.map(formatEvidenceIssue),
  ];
  // Adapter problems can hide unmapped results, so zero diagnostics alone
  // cannot establish a successful reverse traceability check.
  const traceabilityHtml =
    traceabilityDiagnostics.length === 0
      ? adapterIssues.length === 0
        ? '<p class="success">✓ No issues found</p>'
        : '<p class="warning">Unable to complete diagnostics; see Evidence Issues.</p>'
      : `<ul>${traceabilityDiagnostics.map((diagnostic) => `<li class="${diagnostic.severity}">${renderText(formatTraceabilityDiagnostic(diagnostic))}</li>`).join("")}</ul>`;
  const issueHtml =
    issues.length === 0
      ? '<p class="success">✓ No issues found</p>'
      : `<ul>${issues.map((issue) => `<li>${renderText(issue)}</li>`).join("")}</ul>`;
  return withReportLocale(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="format-detection" content="telephone=no"><title>Moura Requirement Coverage</title>
<style>body{font:16px system-ui,sans-serif;line-height:1.5;max-width:72rem;margin:auto;padding:2rem;color:#172033}h1,h2,h3,h4{line-height:1.2}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:1rem}.metric,.case{border:1px solid #ccd3df;border-radius:.5rem;padding:1rem}.metric span{display:block;font-size:1.4rem}.status{font-weight:700}.pass,.success{color:#167044}.fail,.broken,.missing,.error{color:#b42318}.skipped,.unimplemented,.warning{color:#854d0e}.severity{font-size:.8em;text-transform:uppercase}table{border-collapse:collapse}th,td{border:1px solid #ccd3df;padding:.5rem;text-align:left}code{font-size:.9em}*{box-sizing:border-box}.requirement-map{display:grid;gap:1rem}.map-node{border:1px solid #ccd3df;border-radius:.65rem;min-width:0;overflow-wrap:anywhere;color:#172033}.map-node[data-severity=success]{background:#f3faf5;border-color:#94c9a8}.map-node[data-severity=warning]{background:#fffbef;border-color:#dec17c}.map-node[data-severity=error]{background:#fff6f5;border-color:#dfa6a0}.map-node[data-severity=neutral]{background:#f6f7f9}.requirement>summary,.case>summary{position:relative;display:block;list-style:none;padding:1rem 4.5rem 1rem 1rem;cursor:pointer;min-height:44px}.map-node>summary::-webkit-details-marker{display:none}.chevron{position:absolute;right:.5rem;top:50%;transform:translateY(-50%);width:44px;height:44px;display:grid;place-items:center}.chevron::after{content:"";width:10px;height:10px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(-45deg)}details[open]>summary>.chevron::after{transform:rotate(45deg)}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}.requirement>summary h2,.case>summary h4{display:inline-block;vertical-align:middle;margin:0 .75rem .5rem 0;max-width:100%}.requirement-content{padding:0 1rem 1rem}.scenario-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr));gap:1rem;align-items:start}.scenario{padding:1rem}.scenario header h3{margin:0 0 .5rem}.cases{display:grid;gap:.75rem;margin-top:1rem}.case{padding:0}.case-details{padding:0 1rem 1rem}.node-title{display:block;font-size:1em;font-weight:750}.node-id{display:block;font:normal .75rem ui-monospace,monospace;margin-top:.4rem;color:#4b5565}.node-link{color:inherit;text-decoration:none}.node-link:hover .node-title{text-decoration:underline}.node-link:focus-visible,summary:focus-visible{outline:3px solid #2563eb;outline-offset:3px}.badge{display:inline-flex;align-items:center;gap:.3rem;border:1px solid currentColor;border-radius:1rem;padding:.15rem .6rem;font-size:.8rem;white-space:nowrap}.badge[data-severity=success]{color:#16643d;background:#e4f3e9}.badge[data-severity=warning]{color:#754407;background:#fff0c5}.badge[data-severity=error]{color:#a12118;background:#fce5e2}.evidence-list{padding-left:1.25rem}.evidence-list>li{margin:.75rem 0}.evidence-name{margin:.25rem 0}.technical-details>summary{cursor:pointer;min-height:44px;padding:.5rem 0}.required-layers{display:block;font-size:.8rem;margin-top:.5rem}summary a{display:inline-block;min-height:44px} @media(max-width:40rem){body{padding:.75rem}.scenario-grid{grid-template-columns:minmax(0,1fr)}.requirement-content,.scenario{padding:.75rem}.requirement>summary,.case>summary{padding:.75rem 4rem .75rem .75rem}.metrics{grid-template-columns:repeat(auto-fit,minmax(min(100%,11rem),1fr))}h1{font-size:1.65rem}}
</style></head>
<body><main><h1>Moura Requirement Coverage</h1><p>Coverage of declared traceability and evidence. Moura does not prove that a test semantically verifies the specification it declares.</p>
<div class="metrics">${cards}</div><h2>Requirement Map</h2><p>Expand a Requirement or Case to inspect exact verification and Evidence.</p><div class="requirement-map">${hierarchy}</div>
<h2>Pair statuses</h2><ul>${statusCounts}</ul><h2>Per-layer coverage</h2><table><thead><tr><th>Layer</th><th>PASS / required</th></tr></thead><tbody>${layers}</tbody></table><h2>Reverse Traceability</h2>${traceabilityHtml}<h2>Evidence Issues</h2>${issueHtml}</main><script>${requirementMapScript}</script></body></html>\n`);
}

function count(value: CoverageCount): string {
  return `${value.covered} / ${value.total} (${percent(value)}%)`;
}
function percent(value: CoverageCount): number {
  return value.total === 0
    ? 100
    : Math.round((value.covered / value.total) * 100);
}
function title(value: string): string {
  return value === "pairs"
    ? "Required Case × layer pairs"
    : value[0]!.toUpperCase() + value.slice(1);
}
function renderText(value: string): string {
  return escapeHtml(value);
}
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function requirementSourceHref(location: RequirementSourceLocation): string {
  return `./sources/${requirementSourceFilename(location.source)}#${location.anchor}`;
}

export function requirementSourceFilename(source: string): string {
  return `source-${createHash("sha256").update(source, "utf8").digest("hex")}.html`;
}

export function renderRequirementSource(
  source: string,
  markdown: string,
  locations: ReadonlyMap<string, RequirementSourceLocation>,
  translation?: {
    readonly markdown: string;
    readonly locations: ReadonlyMap<string, RequirementSourceLocation>;
  },
): string {
  const content = renderSourceContent(source, markdown, locations);
  const translated = translation
    ? renderSourceContent(source, translation.markdown, translation.locations)
    : undefined;
  return withReportLocale(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(source)} — Moura Requirement source</title><link rel="canonical" href="./${requirementSourceFilename(source)}">
<style>body{font:16px system-ui,sans-serif;max-width:72rem;margin:auto;padding:2rem;color:#172033}a{color:#167044}pre{font:14px ui-monospace,monospace;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.requirement:target{background:#fff3b0;outline:.25rem solid #fff3b0}</style></head>
<body><main><p><a href="../index.html">← Requirement Coverage</a></p><h1>${escapeHtml(source)}</h1><p>English canonical source; Japanese is a translation.</p><p data-fallback hidden>Japanese translation unavailable; showing English.</p><pre data-source-content>${content}</pre>${translated === undefined ? "" : `<template data-translation>${translated}</template>`}</main></body></html>\n`);
}

function sourceLink(
  id: string,
  locations: ReadonlyMap<string, RequirementSourceLocation>,
): string {
  const location = locations.get(id);
  const title = location?.title || id;
  const label = `<span class="node-title" data-map-title="${escapeHtml(id)}" data-map-source="${escapeHtml(location?.source ?? "")}">${renderText(title)}</span><span class="node-id">${renderText(id)}</span>`;
  return location
    ? `<a class="node-link" href="${escapeHtml(requirementSourceHref(location))}">${label}</a>`
    : label;
}

function renderSourceContent(
  source: string,
  markdown: string,
  locations: ReadonlyMap<string, RequirementSourceLocation>,
): string {
  const anchors = new Map(
    [...locations.values()]
      .filter((location) => location.source === source)
      .map((location) => [location.line, location.anchor]),
  );
  return markdown
    .split(/\r\n|\n|\r/u)
    .map((line, index) => {
      const anchor = anchors.get(index + 1);
      const escaped = escapeHtml(line);
      return anchor
        ? `<span class="requirement" id="${anchor}">${escaped}</span>`
        : escaped;
    })
    .join("\n");
}

function nodeBadge(node: CoverageNodeStatus): string {
  return pairBadge(node.status, node.severity);
}

function pairBadge(status: string, severity: string): string {
  const symbol =
    severity === "success" ? "✓" : severity === "warning" ? "!" : "×";
  return `<span class="status badge ${status.toLowerCase()}" data-severity="${severity}"><span aria-hidden="true">${symbol}</span> <span>${renderText(status)}</span></span><span class="sr-only"> severity: ${renderText(severity)}</span>`;
}

/** Attach titles only from validated views, using canonical identity and source. */
export function withRequirementMapTranslation(
  html: string,
  locations: ReadonlyMap<string, RequirementSourceLocation>,
): string {
  return html.replace(
    /<span class="node-title" data-map-title="([^"]*)" data-map-source="([^"]*)">([^<]*)<\/span>/gu,
    (match, id: string, source: string, title: string) => {
      const location = [...locations.entries()].find(
        ([key, value]) =>
          escapeHtml(key) === id && escapeHtml(value.source) === source,
      )?.[1];
      return location?.title
        ? `<span class="node-title" data-map-title="${id}" data-map-source="${source}" data-ja="${escapeHtml(location.title)}">${title}</span>`
        : match;
    },
  );
}

/** Native details provides Enter/Space handling; keep explicit expanded state in sync. */
export const requirementMapScript = `(() => {
  document.querySelectorAll('details.map-node').forEach(details => {
    const summary = details.querySelector('summary');
    const update = () => summary.setAttribute('aria-expanded', String(details.open));
    update();
    details.addEventListener('toggle', update);
    summary.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', event => event.stopPropagation());
    });
  });
})();`;

function renderEvidence(item: Evidence): string {
  const status = {
    passed: "PASS",
    failed: "FAIL",
    broken: "BROKEN",
    skipped: "SKIPPED",
  }[item.status];
  return `<li>${item.name ? `<p class="evidence-name" data-evidence-name>${renderText(item.name)}</p>` : ""}<code>${renderText(item.layer)}</code> — ${pairBadge(status, verificationSeverity(status as VerificationCheckResult["status"]))}${item.source === undefined ? "" : `<details class="technical-details"><summary>Technical details</summary><code>${renderText(item.source)}</code></details>`}</li>`;
}
