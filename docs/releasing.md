# Releasing Moura

Moura uses **Staged Publishing**. GitHub Actions runs `npm stage publish` using
OIDC; a human reviews the staged package in npm and approves formal publication.
A green staging job does **not** mean the version is public in the npm registry.
Do not change the Trusted Publisher to permit direct publication as a workaround.
Changing this release mode requires explicit maintainer review and approval,
including corresponding workflow, regression-test, and documentation changes.

## Before release

1. Update `package.json`, the version printed by `src/cli.ts`, and the official
   `examples/vitest-minimal/package.json` dependency (`^X.Y.Z`) together. Check
   related references and lockfiles. Update CHANGELOG and prepare release notes
   with compatibility changes and migration guidance.
2. Use Node.js 24 and the `packageManager` version in package.json (currently
   pnpm 10.28.1 via Corepack). From a clean checkout run:

   ```sh
   pnpm install --frozen-lockfile
   pnpm build
   test "$(node dist/cli.js --version)" = "moura $(node -p "require('./package.json').version")"
   pnpm lint
   pnpm format:check
   pnpm typecheck
   pnpm test
   pnpm test:coverage
   pnpm test:allure
   pnpm test:package
   pnpm test:onboarding
   pnpm report:allure
   node dist/cli.js validate .
   node dist/cli.js check .
   pnpm report:moura
   node dist/cli.js check test/fixtures/passing-project
   pnpm pack --dry-run
   pnpm quality:site
   ```

   Run `test:package` and `test:onboarding` after `test:allure`: the Allure
   suite resets results; both smokes add supplemental Evidence for self-check.
   Preserve existing report output and user data. For repeated report generation,
   choose a fresh `--output` path rather than removing an existing report.

3. Inspect the dry-run manifest: only `dist/`, `README.md`, `LICENSE` and
   `package.json` should ship. The local-tarball package/onboarding smokes do not
   prove that an unpublished version can be installed from npm.
4. Confirm Linux and Windows CI and the main quality-report Pages deployment.
   Obtain independent PR review and maintainer approval, merge to main, then
   confirm the exact merged commit's CI and version before tagging.

## Stage, approve, then verify

1. Create `vX.Y.Z` on the reviewed, tested commit. Never move an existing release
   tag to repair a workflow. Create and publish its GitHub Release with the
   prepared release notes.
2. `.github/workflows/publish.yml` checks the published GitHub Release, checks
   out its existing tag, verifies tag/package version equality, uses Node 24
   and npm 11.15.0, installs frozen dependencies, builds, tests the installed
   package and inspects package contents. It refuses an already-public version
   (or an indeterminate registry response), then runs **`npm stage publish`**.
3. Review the Actions log and npm package management page's staged package.
   Confirm name, exact version, source/tag/commit, contents and intended
   `latest` dist-tag. A successful stage only registers a candidate.
4. An authorized human approves formal publication in npm. Do not approve an
   unexpected artifact. Confirm registry reflection with read-only commands:

   ```sh
   npm view @specxai/moura@X.Y.Z version dist.integrity --json
   npm view @specxai/moura dist-tags --json
   ```

5. After approval, manually run **Publish to npm** on **main** with
   `operation=verify`, exact `release_version=X.Y.Z`, and `dist_tag=latest`:

   ```sh
   gh workflow run publish.yml --repo specxai/moura --ref main \
     -f operation=verify -f release_version=X.Y.Z -f dist_tag=latest
   ```

   The existing `workflow_dispatch` verification is retained; `verify` is its
   default operation. Release and staging events never start registry smoke
   automatically, since human approval may take arbitrarily long.

## After approval: registry and onboarding verification

The read-only `registry-smoke` job checks out the verification harness at
`refs/tags/vX.Y.Z`, waits a bounded time for the exact public version and requested
dist-tag, then installs **only `@specxai/moura@X.Y.Z` from npm** in a clean copy of
the official example. It verifies `moura --version`, current-run Allure Evidence
metadata, strict traceability check, and non-empty Quality Overview and
Requirement Coverage report. It has no workspace, tarball or local-dist fallback.
For an already-public version the same check can be run locally with
`pnpm test:registry -- X.Y.Z latest` from its matching tag and Node 24.

A verification failure neither unpublishes nor rolls back anything. Check
approval, propagation, exact version, dist-tag and logs before retrying `verify`.
Do not rerun staging to fix a verification-only failure. For older releases,
`latest` may point to a newer release: use a tag actually identifying the version;
do not move `latest` merely to satisfy a historical verification.

## Authentication and infrastructure

Keep npm Trusted Publisher configured for organization/user **specxai**,
repository **moura**, workflow **publish.yml**, permission **npm stage publish**,
and status **Valid**. Check any configured GitHub Environment requirement matches
workflow usage; do not introduce an environment or alter npm settings silently.
Only the staging job has `id-token: write` plus `contents: read`. Registry smoke
has `contents: read` only. Use OIDC short-lived credentials; do not add an
`NPM_TOKEN` or another long-lived npm token. The workflow's temporary `GH_TOKEN`
is GitHub's read-only job token for inspecting the existing GitHub Release.

Pages must use **Settings → Pages → Build and deployment → Source → GitHub
Actions** for the quality-report deployment. Local Japanese-view artifacts are
optional and not a prerequisite for npm staging.

## Troubleshooting and v0.2.0 recovery

### OIDC permission denied for this action

v0.1.2 successfully used `npm stage publish` ([job](https://github.com/specxai/moura/actions/runs/36177364650/job/108211114659)).
PR #85 (`e085cd36de65a8b3ef0bbde3dece535cb0dbbf36`) changed that command to direct
`npm publish --tag latest` while adding registry smoke. The v0.2.0
[run](https://github.com/specxai/moura/actions/runs/38552023048) failed at this direct
publish step, including retry job 115836235149, with E403 / OIDC permission denied
for this action. Build and package checks succeeded. A publisher authorized for
staging does not authorize direct `npm publish`: the latter skips npm's human
approval boundary. Restore the command, not broader publisher permissions.

If staging itself fails, confirm repository/workflow identity, `id-token: write`,
Node/npm versions, Trusted Publisher status and action permission, and any
Environment restriction. Diagnose the actual failed step rather than adding a token.

### Inspect state before retrying

- Inspect the existing GitHub Release and tag commit, not just main:
  `gh release view v0.2.0 --repo specxai/moura` and
  `git rev-parse 'v0.2.0^{commit}'` after fetching tags.
- Inspect npm's staged-package management page using an authorized maintainer
  account. Public `npm view` cannot establish whether a private staged candidate
  exists. Record the staged candidate identifier/source and avoid duplicate stages.
  With an authorized npm maintainer session, read-only CLI alternatives are
  `npm stage list @specxai/moura` and `npm stage view <stage-id>` (npm 11.15.0).
- Check the exact public version and dist-tags with the commands above. A missing
  version (404) differs from registry/auth/network failure. Public versions cannot
  be overwritten with different contents; never try to duplicate-publish one.

### Recover the existing v0.2.0 without moving its tag

The existing `v0.2.0` tag points to
`bc9fbfae469c2f0455bada621b186321a788beda` and contains the old direct-publication
workflow. Re-running its failed release run uses the original workflow revision;
a fix on main alone does not change that run. Do not delete/recreate the Release,
move the tag, or change package.json to work around the failure.

After this fix is reviewed, approved and merged, an authorized maintainer can:

1. Recheck that v0.2.0 is not public and inspect staged candidates in npm. If
   already staged, review and approve that correct candidate instead of restaging.
   If already public, skip staging and run `verify` only.
2. Confirm the existing tag still identifies the reviewed commit above, the
   GitHub Release is published, and the tag's package/CLI/example versions are
   0.2.0 / 0.2.0 / ^0.2.0. Confirm its CI and package verification evidence.
3. If no public version or existing staged candidate exists, explicitly dispatch
   the **fixed workflow on main**, selecting `stage-existing-release`:

   ```sh
   gh workflow run publish.yml --repo specxai/moura --ref main \
     -f operation=stage-existing-release -f release_version=0.2.0
   ```

   This operation is allowed only on main in specxai/moura. Workflow code comes
   from fixed main; package source comes from the unchanged `refs/tags/v0.2.0`.
   It requires an existing published, non-prerelease GitHub Release, repeats the
   tag/version and package checks, refuses a public version and stages using OIDC
   under the same `publish.yml` Trusted Publisher identity. No tag or Release is
   written. Inspect the logged checked-out SHA before npm approval.

4. Review/approve the staged 0.2.0 candidate in npm, wait for registry reflection,
   then dispatch `operation=verify`, `release_version=0.2.0`, `dist_tag=latest`
   on main. Track its run separately from the original failed release run.

For a normal retry, Actions → Publish to npm → the staging run → Re-run failed
jobs, or `gh run rerun RUN_ID --failed --repo specxai/moura`, reuses that run's
workflow revision. Inspect staged/public state first: an ambiguous network
failure may occur after stage registration. Never rerun the old v0.2.0 release
job expecting it to pick up main's fix.

This task has not staged or published 0.2.0, approved an npm candidate, changed
Trusted Publisher settings, moved tags, or changed the Release. npm's private
staging state and actual OIDC staging authorization must be checked by a
maintainer; public registry metadata alone cannot verify them. If the unchanged
publisher has an additional ref/environment restriction that rejects main
manual dispatch, stop and report that constraint. Do not change it or move tags.
An explicitly approved maintainer-operated npm staging session for the same tag
is an alternative subject to npm account permissions; it is not a tested OIDC
fallback. If same-tag staging is otherwise impossible, a new reviewed patch
release/tag is a separate maintainer decision, not an automatic version bump.
