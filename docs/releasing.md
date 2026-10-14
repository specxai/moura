# Releasing Moura

Moura uses **Staged Publishing**. GitHub Actions runs `npm stage publish` using
OIDC; a human reviews the staged package in npm and approves formal publication.
A green staging job does **not** mean the version is public in the npm registry.
Do not change the Trusted Publisher to permit direct publication as a workaround.
Changing this release mode requires explicit maintainer review and approval,
including corresponding workflow, regression-test, and documentation changes.

The failed v0.2.0 release will not be recovered. The next release is a new
**v0.2.1** from a reviewed commit containing this workflow fix. Leave the old
tag and GitHub Release unchanged; follow the normal version-update and release
steps below rather than rerunning its failed publication job.

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
2. `.github/workflows/publish.yml` runs only on GitHub Release publication, checks
   out that release tag, verifies tag/package version equality and that the
   checked-out commit matches the event SHA used for npm provenance, uses Node 24
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
   exact `release_version=X.Y.Z` (next: `0.2.1`), and `dist_tag=latest`:

   ```sh
   gh workflow run publish.yml --repo specxai/moura --ref main \
     -f release_version=X.Y.Z -f dist_tag=latest
   ```

   `workflow_dispatch` performs verification only: it cannot stage or publish.
   Release events never start registry smoke automatically, since human approval
   may take arbitrarily long.

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
approval, propagation, exact version, dist-tag and logs before retrying verification.
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
`NPM_TOKEN` or another long-lived npm token.

Pages must use **Settings → Pages → Build and deployment → Source → GitHub
Actions** for the quality-report deployment. Local Japanese-view artifacts are
optional and not a prerequisite for npm staging.

## Troubleshooting and incident record

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
  `gh release view vX.Y.Z --repo specxai/moura` and
  `git rev-parse 'vX.Y.Z^{commit}'` after fetching tags.
- Inspect npm's staged-package management page using an authorized maintainer
  account. Public `npm view` cannot establish whether a private staged candidate
  exists. Record the staged candidate identifier/source and avoid duplicate stages.
  With an authorized npm maintainer session, read-only CLI alternatives are
  `npm stage list @specxai/moura` and `npm stage view <stage-id>` (npm 11.15.0).
- Check the exact public version and dist-tags with the commands above. A missing
  version (404) differs from registry/auth/network failure. Public versions cannot
  be overwritten with different contents; never try to duplicate-publish one.

### Failed staging or verification

Actions → Publish to npm → the relevant run → Re-run failed jobs, or
`gh run rerun RUN_ID --failed --repo specxai/moura`, reuses that run's original
workflow revision. Inspect staged/public state first: an ambiguous network
failure may occur after candidate registration. If a correct candidate exists,
review and approve it in npm instead of registering another candidate. If the
version is already public, rerun only manual registry verification.

Do not rerun the failed v0.2.0 release job: it contains the direct-publication
workflow, and a fix on main does not change that run. There is no manual staging
or old-tag recovery operation. Release v0.2.1 normally from a new reviewed commit.
A manual workflow dispatched on main must never build an old tag for staging:
checking out a tag does not change the run's GitHub SHA/ref, so npm provenance
could advertise a different source commit. The release-only job and SHA equality
check keep the package source aligned with the release event's provenance.

Do not delete/recreate historical Releases or move tags to repair failures.
If a new release has an irreparable artifact/workflow defect, stop and obtain
maintainer approval for a new patch version and tag. Never overwrite a public
version or add a direct-publication permission/token as a workaround.
