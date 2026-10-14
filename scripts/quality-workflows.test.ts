import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it as vitestIt } from "vitest";
import { parse } from "yaml";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";

const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-005/SCN-002/CASE-002"],
  "integration",
);
interface Step {
  name: string;
  uses?: string;
  run?: string;
  if?: string;
  with?: Record<string, unknown>;
}
interface Workflow {
  on: Record<string, unknown>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  permissions: Record<string, string>;
  jobs: Record<
    string,
    {
      if?: string;
      needs?: string[];
      permissions?: Record<string, string>;
      steps: Step[];
    }
  >;
}
function workflow(name: string): Workflow {
  return parse(
    readFileSync(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    ),
  ) as Workflow;
}
const ci = workflow("ci");
const producer = workflow("japanese-views");
function refreshEvent() {
  return {
    repository: "specxai/moura",
    workflow: "CI",
    run_id: 100,
    ref: "refs/heads/main",
    sha: "a".repeat(40),
    event_name: "workflow_run",
    event: {
      workflow_run: {
        repository: { full_name: "specxai/moura" },
        head_repository: { full_name: "specxai/moura" },
        path: ".github/workflows/japanese-views.yml",
        head_branch: "main",
        head_sha: "b".repeat(40),
        event: "workflow_dispatch",
        status: "completed",
        conclusion: "success",
      },
    },
  };
}
// These configuration guards use only property access and boolean comparisons,
// shared by GitHub expressions and JavaScript; evaluate the actual YAML guards.
function accepts(
  expression: string | undefined,
  github: ReturnType<typeof refreshEvent>,
): boolean {
  return Boolean(
    runInNewContext(expression ?? "true", { github }, { timeout: 100 }),
  );
}
function canPublish(github: ReturnType<typeof refreshEvent>): boolean {
  return ["quality", "windows-smoke", "deploy-pages"].every((name) =>
    accepts(ci.jobs[name]!.if, github),
  );
}

describe("trusted Japanese completion refresh", () => {
  it("listens only for completion of the manual Japanese workflow on main, without a loop", () => {
    expect(ci.on.workflow_run).toEqual({
      workflows: ["Generate Japanese views"],
      types: ["completed"],
      branches: ["main"],
    });
    expect(Object.keys(producer.on)).toEqual(["workflow_dispatch"]);
    expect(ci.on).toHaveProperty("push");
    expect(ci.on).toHaveProperty("pull_request");
    expect(ci.on).toHaveProperty("workflow_dispatch");
    expect(canPublish(refreshEvent())).toBe(true);
    expect(ci.jobs["deploy-pages"]!.needs).toEqual([
      "quality",
      "windows-smoke",
    ]);
  });

  it.each(["failure", "cancelled", "timed_out", "action_required"])(
    "does not refresh from producer conclusion %s",
    (conclusion) => {
      const github = refreshEvent();
      github.event.workflow_run.conclusion = conclusion;
      for (const job of ["quality", "windows-smoke"])
        expect(accepts(ci.jobs[job]!.if, github)).toBe(false);
      expect(canPublish(github)).toBe(false);
    },
  );

  it.each([
    { repository: { full_name: "other/moura" } },
    { head_repository: { full_name: "fork/moura" } },
    { path: ".github/workflows/other.yml" },
    { head_branch: "feature" },
    { event: "pull_request" },
    { status: "in_progress" },
  ])("rejects an untrusted refresh origin: %j", (change) => {
    const github = refreshEvent();
    Object.assign(github.event.workflow_run, change);
    expect(canPublish(github)).toBe(false);
    for (const job of ["quality", "windows-smoke"])
      expect(accepts(ci.jobs[job]!.if, github)).toBe(false);
  });

  it("checks out GitHub's trusted main SHA rather than the producer or artifact code", () => {
    const github = refreshEvent();
    for (const job of ["quality", "windows-smoke"]) {
      const checkout = ci.jobs[job]!.steps.find((step) =>
        step.uses?.startsWith("actions/checkout@"),
      )!;
      const ref = checkout.with?.ref as string;
      const expression = ref.slice(3, -2).trim();
      expect(runInNewContext(expression, { github })).toBe(github.sha);
      github.event_name = "pull_request";
      expect(runInNewContext(expression, { github })).toBe("");
      github.event_name = "workflow_run";
    }
    github.ref = "refs/heads/other-default";
    expect(canPublish(github)).toBe(false);
    github.ref = "refs/heads/main";
    github.repository = "fork/moura";
    expect(canPublish(github)).toBe(false);
  });

  it("preserves ordinary push/manual main deployment and PR checks without PR deployment", () => {
    const github = refreshEvent();
    for (const event of ["push", "workflow_dispatch"]) {
      github.event_name = event;
      expect(canPublish(github)).toBe(true);
      github.ref = "refs/heads/feature";
      expect(canPublish(github)).toBe(false);
      github.ref = "refs/heads/main";
    }
    github.event_name = "pull_request";
    expect(accepts(ci.jobs.quality!.if, github)).toBe(true);
    expect(accepts(ci.jobs["windows-smoke"]!.if, github)).toBe(true);
    expect(canPublish(github)).toBe(false);
  });

  it("isolates failed completions so they cannot cancel running or queued main CI", () => {
    const github = refreshEvent();
    function group(): string {
      return ci.concurrency.group.replace(
        /\$\{\{(.*?)\}\}/gu,
        (_, expression: string) =>
          String(
            runInNewContext(expression, {
              github,
              format: (template: string, id: number) =>
                template.replace("{0}", String(id)),
            }),
          ),
      );
    }
    const successGroup = group();
    github.event_name = "push";
    expect(group()).toBe(successGroup);
    github.event_name = "workflow_run";
    github.event.workflow_run.conclusion = "failure";
    const failedGroup = group();
    expect(failedGroup).not.toBe(successGroup);
    github.run_id++;
    expect(group()).not.toBe(failedGroup);
    expect(ci.concurrency["cancel-in-progress"]).toBe(true);
  });

  it("requires generation, validation, and success upload before successful completion", () => {
    const steps = producer.jobs.generate!.steps;
    const generate = steps.findIndex(
      (step) => step.run === "pnpm docs:ja:generate",
    );
    const validate = steps.findIndex(
      (step) => step.run === "pnpm docs:ja:validate",
    );
    const upload = steps.findIndex(
      (step) => step.with?.name === "moura-japanese-views",
    );
    expect(generate).toBeGreaterThanOrEqual(0);
    expect(validate).toBeGreaterThan(generate);
    expect(upload).toBeGreaterThan(validate);
    // Unconditional steps have GitHub's implicit success() gate. No ignored
    // errors: any generation/validation/upload failure makes the run fail.
    for (const index of [generate, validate, upload]) {
      expect(steps[index]!.if).toBeUndefined();
      expect(steps[index]).not.toHaveProperty("continue-on-error");
    }
    expect(producer.jobs.generate).not.toHaveProperty("continue-on-error");
    expect(steps[upload]!.with?.["if-no-files-found"]).toBe("error");
    const debug = steps.find(
      (step) => step.with?.name === "moura-japanese-views-failed-validation",
    )!;
    expect(debug.if).toContain("failure()");
    expect(debug.if).toContain("steps.validate.outcome == 'failure'");
  });

  it("adds no write credential, producer Pages deployment, or CI OpenAI call", () => {
    expect(producer.permissions).toEqual({ contents: "read" });
    expect(ci.permissions).toEqual({ contents: "read" });
    expect(ci.jobs.quality!.permissions).toEqual({
      contents: "read",
      actions: "read",
    });
    expect(ci.jobs["deploy-pages"]!.permissions).toEqual({
      pages: "write",
      "id-token": "write",
    });
    expect(JSON.stringify(producer)).not.toMatch(
      /deploy-pages|upload-pages|actions.*write|workflow_dispatch.*POST/,
    );
    expect(JSON.stringify(ci)).not.toMatch(/OPENAI|docs:ja:generate|secrets\./);
    for (const job of Object.values(ci.jobs))
      expect(job.permissions?.actions).not.toBe("write");
    const upload = ci.jobs.quality!.steps.find((step) =>
      step.uses?.startsWith("actions/upload-pages-artifact@"),
    )!;
    expect(accepts(upload.if, refreshEvent())).toBe(true);
    expect(
      ci.jobs.quality!.steps.some((step) =>
        step.run?.includes("fetch-japanese-views.ts"),
      ),
    ).toBe(true);
  });
});

describe("staged npm release contract", () => {
  const release = workflow("publish");
  const stage = release.jobs.publish!;
  const verify = release.jobs["registry-smoke"]!;
  const docs = readFileSync(
    new URL("../docs/releasing.md", import.meta.url),
    "utf8",
  );
  function runs(
    job: typeof stage,
    event: string,
    operation = "verify",
    ref = "refs/heads/main",
    repository = "specxai/moura",
  ): boolean {
    return Boolean(
      runInNewContext(
        job.if!,
        {
          github: { event_name: event, ref, repository },
          inputs: { operation },
        },
        { timeout: 100 },
      ),
    );
  }

  it("stages a release without claiming it is public or running registry smoke", () => {
    expect(release.on.release).toEqual({ types: ["published"] });
    expect(runs(stage, "release")).toBe(true);
    expect(runs(verify, "release")).toBe(false);
    expect(
      stage.steps.filter((step) => step.run === "npm stage publish"),
    ).toHaveLength(1);
    for (const job of Object.values(release.jobs))
      for (const step of job.steps)
        expect(step.run ?? "").not.toMatch(/\bnpm\s+publish\b/u);
    expect(stage.steps.at(-1)?.run).toContain(
      "npm registry publication has NOT been verified",
    );
  });

  it("keeps verification the manual default, independent of the staging job", () => {
    const dispatch = release.on.workflow_dispatch as {
      inputs: Record<string, { default?: string; options?: string[] }>;
    };
    expect(dispatch.inputs.operation?.default).toBe("verify");
    expect(dispatch.inputs.operation?.options).toEqual([
      "verify",
      "stage-existing-release",
    ]);
    expect(runs(stage, "workflow_dispatch")).toBe(false);
    expect(runs(verify, "workflow_dispatch")).toBe(true);
    expect(verify.needs).toBeUndefined();
    const smoke = verify.steps.find(
      (step) => step.name === "Verify the released registry artifact",
    )!;
    expect(smoke.run).toBe(
      'pnpm test:registry -- "$RELEASE_VERSION" "$DIST_TAG"',
    );
    expect(verify.steps[0]!.with?.ref).toBe(
      "refs/tags/v${{ inputs.release_version }}",
    );
    expect(verify.steps.at(-1)?.run).toContain(
      "No npm publication was rolled back",
    );
  });

  it("allows explicit existing-tag recovery only on main and never verifies a staged candidate", () => {
    expect(runs(stage, "workflow_dispatch", "stage-existing-release")).toBe(
      true,
    );
    expect(runs(verify, "workflow_dispatch", "stage-existing-release")).toBe(
      false,
    );
    expect(
      runs(
        stage,
        "workflow_dispatch",
        "stage-existing-release",
        "refs/tags/v0.2.0",
      ),
    ).toBe(false);
    for (const job of [stage, verify]) {
      expect(runs(job, "push", "stage-existing-release")).toBe(false);
      expect(
        runs(
          job,
          "workflow_dispatch",
          "stage-existing-release",
          "refs/heads/main",
          "fork/moura",
        ),
      ).toBe(false);
    }
    expect(stage.steps[0]!.run).toContain("releases/tags/$RELEASE_TAG");
    expect(stage.steps[0]!.run).toContain("r.draft || r.prerelease");
    expect(stage.steps[1]!.with?.ref).toBe(
      "refs/tags/${{ steps.release.outputs.tag }}",
    );
    expect(
      stage.steps.find(
        (step) =>
          step.name === "Refuse to restage an already published version",
      )?.run,
    ).toContain('"$status" != 404');
  });

  it("preserves OIDC least privilege, tag/version and package checks", () => {
    expect(stage.permissions).toEqual({
      contents: "read",
      "id-token": "write",
    });
    expect(verify.permissions).toEqual({ contents: "read" });
    expect(JSON.stringify(release)).not.toContain("NPM_TOKEN");
    const scripts = stage.steps.map((step) => step.run ?? "").join("\n");
    for (const command of [
      "pnpm install --frozen-lockfile",
      "pnpm build",
      "pnpm test:package",
      "pnpm pack --dry-run",
    ])
      expect(scripts).toContain(command);
    expect(scripts).toContain('"$release_version" != "$package_version"');
    expect(scripts).toContain("npm@11.15.0");
    expect(
      stage.steps.find((step) => step.uses?.startsWith("actions/setup-node@"))
        ?.with?.["node-version"],
    ).toBe(24);
  });

  it("documents the implemented staging, approval, verification and recovery operations", () => {
    expect(docs).toContain("`npm stage publish`");
    expect(docs).toContain("human");
    expect(docs).toContain("approves formal publication");
    for (const operation of ["verify", "stage-existing-release"])
      expect(docs).toContain(`-f operation=${operation}`);
    expect(docs).toContain("--ref main");
    expect(docs).toContain("explicit maintainer review and approval");
    expect(docs).toContain("does not change that run");
  });
});
