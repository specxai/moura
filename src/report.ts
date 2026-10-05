import { createHash } from "node:crypto";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
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
  coverageStatuses,
  type CoverageCount,
} from "./coverage.js";
import { canonicalId } from "./id.js";
import type { MouraManifest } from "./manifest.js";
import {
  locateSpecificationMarkdown,
  type RequirementSourceLocation,
} from "./markdown.js";
import { withReportLocale } from "./report-locale.js";
import type { VerificationLayer } from "./model.js";

export interface ReportCommandOutput {
  readonly exitCode: 0 | 1;
  readonly outputPath?: string;
  readonly errors: readonly string[];
}

export async function reportProjectDirectory(
  directory: string,
  options: CheckCommandOptions = {},
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
  try {
    outputPath = await writeReportFile(
      directory,
      renderCoverageReport(
        evaluation.manifest,
        evaluation.check,
        evaluation.adapterIssues,
        evaluation.traceabilityDiagnostics,
        evaluation.requirementLocations,
        specificationLocations,
      ),
      new Map([
        ...evaluation.requirementSources,
        ...evaluation.specificationSources,
      ]),
      new Map(
        [
          ...specificationLocations.values(),
          ...evaluation.requirementLocations.values(),
        ].map((location, index) => [String(index), location]),
      ),
    );
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
    errors: [
      ...evaluation.adapterIssues.map(formatEvidenceAdapterIssue),
      ...semanticErrors,
      ...evaluation.traceabilityDiagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map(formatTraceabilityDiagnostic),
    ],
  };
}

async function writeReportFile(
  directory: string,
  contents: string,
  requirementSources: ReadonlyMap<string, string>,
  requirementLocations: ReadonlyMap<string, RequirementSourceLocation>,
): Promise<string> {
  const projectRoot = await realpath(resolve(directory));
  const outputDirectory = resolve(projectRoot, "moura-report");
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory);
  const sourceDirectory = resolve(outputDirectory, "sources");
  await mkdir(sourceDirectory);
  for (const [source, markdown] of requirementSources) {
    await writeFile(
      resolve(sourceDirectory, requirementSourceFilename(source)),
      renderRequirementSource(source, markdown, requirementLocations),
      "utf8",
    );
  }
  const outputPath = resolve(outputDirectory, "index.html");
  await writeFile(outputPath, contents, "utf8");
  return outputPath;
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
): string {
  const summary = summarizeCoverage(manifest, check);
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
        `<li><span class="status ${status.toLowerCase()}" data-severity="${verificationSeverity(status)}">${status}</span> <span class="severity ${verificationSeverity(status)}">${verificationSeverity(status)}</span> ${check.entries.filter((entry) => entry.status === status).length}</li>`,
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
                  return `<li><code>${renderText(layer)}</code> <span class="status ${status.toLowerCase()}" data-severity="${severity}">${status}</span> <span class="severity ${severity}">${severity}</span></li>`;
                })
                .join("");
              return `<section class="case"><h4>${sourceLink(caseId, specificationLocations)}</h4><ul>${statuses}</ul></section>`;
            })
            .join("");
          return `<section><h3>${sourceLink(canonicalId([requirement, scenario]), specificationLocations)}</h3>${cases}</section>`;
        })
        .join("");
      const requirementId = canonicalId([requirement]);
      const location = requirementLocations.get(requirementId);
      const label = renderText(requirementId);
      const heading = location
        ? `<a href="${escapeHtml(requirementSourceHref(location))}">${label}</a>`
        : label;
      const specification = specificationLocations.get(requirementId);
      return `<article><h2>${heading}</h2>${specification ? `<p><a href="${escapeHtml(requirementSourceHref(specification))}">Specification</a></p>` : ""}${scenarios}</article>`;
    })
    .join("");
  const issues = [
    ...adapterIssues.map(formatEvidenceAdapterIssue),
    ...check.evidenceIssues.map(formatEvidenceIssue),
  ];
  const traceabilityHtml =
    traceabilityDiagnostics.length === 0
      ? "<p>None.</p>"
      : `<ul>${traceabilityDiagnostics.map((diagnostic) => `<li class="${diagnostic.severity}">${renderText(formatTraceabilityDiagnostic(diagnostic))}</li>`).join("")}</ul>`;
  const issueHtml =
    issues.length === 0
      ? "<p>None.</p>"
      : `<ul>${issues.map((issue) => `<li>${renderText(issue)}</li>`).join("")}</ul>`;
  return withReportLocale(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="format-detection" content="telephone=no"><title>Moura Requirement Coverage</title>
<style>body{font:16px system-ui,sans-serif;line-height:1.5;max-width:72rem;margin:auto;padding:2rem;color:#172033}h1,h2,h3,h4{line-height:1.2}.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));gap:1rem}.metric,.case{border:1px solid #ccd3df;border-radius:.5rem;padding:1rem}.metric span{display:block;font-size:1.4rem}.status{font-weight:700}.pass,.success{color:#167044}.fail,.broken,.missing,.error{color:#b42318}.skipped,.unimplemented,.warning{color:#854d0e}.severity{font-size:.8em;text-transform:uppercase}table{border-collapse:collapse}th,td{border:1px solid #ccd3df;padding:.5rem;text-align:left}code{font-size:.9em}</style></head>
<body><main><h1>Moura Requirement Coverage</h1><p>Coverage of declared traceability and evidence. Moura does not prove that a test semantically verifies the specification it declares.</p>
<div class="metrics">${cards}</div><h2>Pair statuses</h2><ul>${statusCounts}</ul><h2>Per-layer coverage</h2><table><thead><tr><th>Layer</th><th>PASS / required</th></tr></thead><tbody>${layers}</tbody></table>
<h2>Requirement hierarchy and exact verification gaps</h2>${hierarchy}<h2>Reverse traceability diagnostics</h2>${traceabilityHtml}<h2>Evidence issues</h2>${issueHtml}</main></body></html>\n`);
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
  return location
    ? `<a href="${escapeHtml(requirementSourceHref(location))}">${renderText(id)}</a>`
    : renderText(id);
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
