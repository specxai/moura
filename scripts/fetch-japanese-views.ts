import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parseManifest } from "../src/manifest.js";
import { isDirectExecution } from "./direct-execution.js";
import { GENERATED_VIEW_NOTICE } from "./generate-japanese-views.js";
import { validateJapaneseView } from "./validate-japanese-views.js";

const repository = "specxai/moura";
const workflowPath = ".github/workflows/japanese-views.yml";
const artifactName = "moura-japanese-views";
const sourcePaths = ["req.md", "spec.md", "moura.yaml"] as const;
const stagingPath = "node_modules/.cache/moura-japanese-views";
const maxBytes = 5 * 1024 * 1024;

interface ProducerRun {
  id: number;
  workflow_id: number;
  path: string;
  head_branch: string;
  head_sha: string;
  event: string;
  status: string;
  conclusion: string | null;
  created_at: string;
  run_started_at: string;
  run_attempt: number;
  repository: { full_name: string };
  head_repository: { full_name: string };
}

interface Artifact {
  id: number;
  name: string;
  expired: boolean;
  size_in_bytes: number;
  created_at: string;
  expires_at: string;
  digest: string;
  workflow_run: { id: number; head_sha: string; head_branch: string };
}

export interface JapaneseViews {
  readonly sourceSha: string;
  readonly runId: number;
  readonly artifactId: number;
  readonly sourceDigests: Readonly<
    Record<(typeof sourcePaths)[number], string>
  >;
  readonly requirements: string;
  readonly specifications: string;
}

export interface JapaneseViewsResult {
  readonly views?: JapaneseViews;
  readonly messages: readonly string[];
}

export interface JapaneseArtifactAccess {
  json: (path: string) => Promise<unknown>;
  download: (artifact: Artifact) => Promise<{
    requirements: string;
    specifications: string;
  }>;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function canonicalInputs(root: string): Promise<Record<string, Buffer>> {
  return Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => [
        path,
        await readFile(resolve(root, path)),
      ]),
    ),
  );
}

function validatePair(
  inputs: Record<string, Buffer>,
  views: Pick<JapaneseViews, "requirements" | "specifications">,
): void {
  const manifest = parseManifest(inputs["moura.yaml"]!.toString("utf8"));
  if (!manifest.value || manifest.errors.length)
    throw new Error("Cannot validate Japanese views with an invalid manifest");
  for (const [path, role] of [
    ["req.md", "requirements"],
    ["spec.md", "specifications"],
  ] as const) {
    if (!views[role]?.startsWith(GENERATED_VIEW_NOTICE))
      throw new Error(
        `${path}: missing document or generated bilingual notice`,
      );
    const problems = validateJapaneseView(
      inputs[path]!.toString("utf8"),
      views[role],
      role,
      manifest.value,
    );
    if (problems.length)
      throw new Error(
        `${path}: consumer validation failed: ${problems.join("; ")}`,
      );
  }
}

function trustedRun(run: ProducerRun, workflowId: number): boolean {
  return (
    Number.isSafeInteger(run.id) &&
    run.id > 0 &&
    run.workflow_id === workflowId &&
    run.path === workflowPath &&
    run.repository?.full_name === repository &&
    run.head_repository?.full_name === repository &&
    run.head_branch === "main" &&
    run.event === "workflow_dispatch" &&
    run.status === "completed" &&
    run.conclusion === "success" &&
    /^[a-f0-9]{40}$/u.test(run.head_sha) &&
    Number.isFinite(Date.parse(run.created_at))
  );
}

/** Newest eligible success, not newest attempt. Search at most 300 recent runs.
 * Artifacts are ordered by creation time, including reruns of older runs.
 * Rejected candidates never prevent a still-fresh older success from being used.
 */
export async function selectJapaneseViews(
  root: string,
  access: JapaneseArtifactAccess,
  now = Date.now(),
): Promise<JapaneseViewsResult> {
  const messages: string[] = [];
  try {
    const inputs = await canonicalInputs(root);
    const workflow = (await access.json(
      `actions/workflows/japanese-views.yml`,
    )) as {
      id: number;
      path: string;
    };
    if (!Number.isSafeInteger(workflow.id) || workflow.path !== workflowPath)
      throw new Error("Unexpected Japanese producer workflow");
    const runs: ProducerRun[] = [];
    for (let page = 1; page <= 3; page++) {
      const response = (await access.json(
        `actions/workflows/${workflow.id}/runs?branch=main&event=workflow_dispatch&per_page=100&page=${page}`,
      )) as { workflow_runs: ProducerRun[] };
      runs.push(...response.workflow_runs);
      if (response.workflow_runs.length < 100) break;
    }
    // The run-list payload's run_started_at is the latest attempt's start,
    // unlike created_at (original run) or updated_at (completion/status updates).
    // Pagination during a rerun can repeat a run; retain its highest attempt.
    const attempts = new Map<number, ProducerRun>();
    for (const run of runs) {
      const previous = attempts.get(run.id);
      if (!previous || run.run_attempt > previous.run_attempt)
        attempts.set(run.id, run);
    }
    runs.splice(0, runs.length, ...attempts.values());
    runs.sort(
      (a, b) =>
        Date.parse(b.run_started_at) - Date.parse(a.run_started_at) ||
        b.run_attempt - a.run_attempt ||
        b.id - a.id,
    );
    const latest = runs[0];
    if (latest)
      messages.push(
        `Latest producer attempt ${latest.id} (attempt ${latest.run_attempt}): ${latest.conclusion ?? latest.status}`,
      );
    const candidates: { run: ProducerRun; artifact: Artifact }[] = [];
    for (const run of runs) {
      if (!trustedRun(run, workflow.id)) {
        messages.push(`Run ${run.id}: not a trusted successful main producer`);
        continue;
      }
      try {
        const response = (await access.json(
          `actions/runs/${run.id}/artifacts?per_page=100`,
        )) as { artifacts: Artifact[] };
        const artifacts = response.artifacts.filter(
          (artifact) =>
            artifact.name === artifactName &&
            Number.isSafeInteger(artifact.id) &&
            artifact.id > 0 &&
            artifact.expired === false &&
            Date.parse(artifact.expires_at) > now &&
            Number.isFinite(Date.parse(artifact.created_at)) &&
            artifact.size_in_bytes > 0 &&
            artifact.size_in_bytes <= maxBytes &&
            /^sha256:[a-f0-9]{64}$/u.test(artifact.digest) &&
            artifact.workflow_run?.id === run.id &&
            artifact.workflow_run.head_sha === run.head_sha &&
            artifact.workflow_run.head_branch === "main",
        );
        if (artifacts.length === 0)
          messages.push(
            `Run ${run.id}: no unexpired success artifact with matching provenance`,
          );
        candidates.push(...artifacts.map((artifact) => ({ run, artifact })));
      } catch (error) {
        messages.push(`Run ${run.id}: ${errorMessage(error)}`);
      }
    }
    // Artifact creation order handles reruns of older workflow runs too.
    candidates.sort(
      (a, b) =>
        Date.parse(b.artifact.created_at) - Date.parse(a.artifact.created_at) ||
        b.artifact.id - a.artifact.id,
    );
    for (const { run, artifact } of candidates) {
      try {
        for (const path of sourcePaths) {
          const source = (await access.json(
            `contents/${path}?ref=${run.head_sha}`,
          )) as {
            type: string;
            encoding: string;
            content: string;
          };
          if (
            source.type !== "file" ||
            source.encoding !== "base64" ||
            typeof source.content !== "string" ||
            !Buffer.from(source.content, "base64").equals(inputs[path]!)
          )
            throw new Error(
              `${path}: producer canonical bytes differ from checkout or are unavailable`,
            );
        }
        const pair = await access.download(artifact);
        validatePair(inputs, pair);
        const views: JapaneseViews = {
          ...pair,
          sourceSha: run.head_sha,
          runId: run.id,
          artifactId: artifact.id,
          sourceDigests: Object.fromEntries(
            sourcePaths.map((path) => [path, sha256(inputs[path]!)]),
          ) as JapaneseViews["sourceDigests"],
        };
        messages.push(
          `Using last validated Japanese views: run ${run.id}, artifact ${artifact.id}, source ${run.head_sha}`,
        );
        return { views, messages };
      } catch (error) {
        messages.push(
          `Run ${run.id}, artifact ${artifact.id}: ${errorMessage(error)}`,
        );
      }
    }
    messages.push(
      "Japanese documentation unavailable: no eligible artifact in the 300-run search window",
    );
  } catch (error) {
    messages.push(`Japanese documentation unavailable: ${errorMessage(error)}`);
  }
  return { messages };
}

/** Recheck staged data at assembly time; a previous retrieval is not a bypass. */
export async function readJapaneseViews(
  root: string,
): Promise<JapaneseViewsResult> {
  try {
    const stage = resolve(root, stagingPath);
    const metadata = JSON.parse(
      await readFile(resolve(stage, "provenance.json"), "utf8"),
    ) as Omit<JapaneseViews, "requirements" | "specifications">;
    if (
      !/^[a-f0-9]{40}$/u.test(metadata.sourceSha) ||
      !Number.isSafeInteger(metadata.runId) ||
      metadata.runId <= 0 ||
      !Number.isSafeInteger(metadata.artifactId) ||
      metadata.artifactId <= 0
    )
      throw new Error("Invalid staged Japanese provenance");
    const inputs = await canonicalInputs(root);
    for (const path of sourcePaths)
      if (metadata.sourceDigests?.[path] !== sha256(inputs[path]!))
        throw new Error(
          `${path}: staged Japanese canonical digest differs from checkout`,
        );
    const views: JapaneseViews = {
      ...metadata,
      requirements: await readFile(resolve(stage, "req.md"), "utf8"),
      specifications: await readFile(resolve(stage, "spec.md"), "utf8"),
    };
    validatePair(inputs, views);
    return { views, messages: [] };
  } catch (error) {
    return {
      messages: [`Japanese documentation unavailable: ${errorMessage(error)}`],
    };
  }
}

export async function fetchJapaneseViews(
  root: string,
  access: JapaneseArtifactAccess,
): Promise<JapaneseViewsResult> {
  const stage = resolve(root, stagingPath);
  try {
    await rm(stage, { recursive: true, force: true });
  } catch (error) {
    return {
      messages: [`Japanese staging unavailable: ${errorMessage(error)}`],
    };
  }
  const result = await selectJapaneseViews(root, access);
  if (result.views) {
    try {
      await mkdir(stage, { recursive: true });
      const { requirements, specifications, ...metadata } = result.views;
      await writeFile(resolve(stage, "req.md"), requirements);
      await writeFile(resolve(stage, "spec.md"), specifications);
      // Written last: assembly requires the complete pair and this metadata.
      await writeFile(
        resolve(stage, "provenance.json"),
        JSON.stringify(metadata),
      );
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      return {
        messages: [
          ...result.messages,
          `Japanese staging failed: ${errorMessage(error)}`,
        ],
      };
    }
  }
  return result;
}

async function responseBytes(response: Response): Promise<Buffer> {
  if (!response.ok)
    throw new Error(`GitHub retrieval failed: HTTP ${response.status}`);
  const parts: Uint8Array[] = [];
  let size = 0;
  if (!response.body) throw new Error("Empty GitHub response");
  for await (const part of response.body) {
    size += part.length;
    if (size > maxBytes)
      throw new Error("GitHub response exceeded 5 MiB limit");
    parts.push(part);
  }
  return Buffer.concat(parts);
}

/** Ubuntu CI has unzip. Read only the two literal members to stdout; never
 * extract archive paths to disk, execute content, or copy arbitrary members.
 */
export async function readJapaneseArchive(bytes: Buffer): Promise<{
  requirements: string;
  specifications: string;
}> {
  const directory = await mkdtemp(resolve(tmpdir(), "moura-japanese-archive-"));
  try {
    const archive = resolve(directory, "views.zip");
    await writeFile(archive, bytes);
    function unzip(args: string[]): string {
      const result = spawnSync("unzip", args, {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
        timeout: 5000,
      });
      if (result.error || result.status !== 0)
        throw new Error("Cannot read bounded Japanese artifact ZIP members");
      return result.stdout;
    }
    const names = unzip(["-Z", "-1", archive]).trim().split("\n");
    for (const name of ["req.md", "spec.md"])
      if (names.filter((entry) => entry === name).length !== 1)
        throw new Error(`Artifact must contain exactly one ${name}`);
    return {
      requirements: unzip(["-p", archive, "req.md"]),
      specifications: unzip(["-p", archive, "spec.md"]),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function githubArtifactAccess(
  token: string,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): JapaneseArtifactAccess {
  const api = (path: string) =>
    request(`https://api.github.com/repos/${repository}/${path}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
      redirect: "manual",
    });
  return {
    json: async (path) =>
      JSON.parse((await responseBytes(await api(path))).toString("utf8")),
    download: async (artifact) => {
      const response = await api(`actions/artifacts/${artifact.id}/zip`);
      if (response.status !== 302)
        throw new Error(
          `Artifact download redirect failed: HTTP ${response.status}`,
        );
      const location = response.headers.get("location");
      if (!location || new URL(location).protocol !== "https:")
        throw new Error("Unsafe artifact download redirect");
      // Signed storage URL gets no GitHub token. Do not log it or follow further redirects.
      const bytes = await responseBytes(
        await request(location, { signal, redirect: "error" }),
      );
      if (`sha256:${sha256(bytes)}` !== artifact.digest)
        throw new Error("Artifact archive digest mismatch");
      return readJapaneseArchive(bytes);
    },
  };
}

function errorMessage(error: unknown): string {
  // Do not surface signed storage URLs, auth headers, or arbitrary response bodies.
  return error instanceof Error
    ? error.message.split(/[\r\n]/u)[0]!.replace(/https?:\/\/\S+/gu, "[URL]")
    : "Unknown retrieval failure";
}

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? ".");
  const token = process.env.GH_TOKEN;
  const stage = resolve(root, stagingPath);
  let result: JapaneseViewsResult;
  if (!token || process.env.GITHUB_REPOSITORY !== repository) {
    await rm(stage, { recursive: true, force: true });
    result = {
      messages: [
        "Japanese documentation unavailable: expected repository and read-only GitHub token required",
      ],
    };
  } else {
    result = await fetchJapaneseViews(
      root,
      githubArtifactAccess(token, AbortSignal.timeout(90_000)),
    );
  }
  const text = result.messages.join("\n");
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `\n## Japanese documentation\n\n\`\`\`text\n${text.replaceAll("`", "'")}\n\`\`\`\n\n[Producer workflow](https://github.com/${repository}/actions/workflows/japanese-views.yml)\n`,
    );
}

if (isDirectExecution(import.meta.url))
  main().catch((error: unknown) => {
    console.error(`Japanese retrieval failed: ${errorMessage(error)}`);
    process.exitCode = 1;
  });
