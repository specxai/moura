# Moura 0.2.1

Release notes prepared for review. This PR does not stage or publish a package,
create a tag or GitHub Release, or authorize a merge.

Moura 0.2.1 carries the Report CLI v2 features prepared for v0.2.0: portable
Quality Overview, optional Allure and coverage HTML integration, improved
Requirement Map navigation and Evidence details, and locally validated Japanese
views. It also contains the Staged Publishing restoration from
[PR #113](https://github.com/specxai/moura/pull/113). There are no further runtime
or API compatibility changes from v0.2.0 and no dependency upgrades in this
release-preparation PR.

## v0.2.0 publication failure and recovery

v0.1.2 successfully used `npm stage publish`. PR #85
(`e085cd36de65a8b3ef0bbde3dece535cb0dbbf36`) replaced it with direct
`npm publish --tag latest` while adding registry smoke. The v0.2.0
[publication run](https://github.com/specxai/moura/actions/runs/38552023048),
including [retry job 115836235149](https://github.com/specxai/moura/actions/runs/38552023048/job/115836235149),
failed at that direct-publication step with E403 / OIDC permission denied for
this action. Build and package checks succeeded. The Trusted Publisher's
staging permission did not authorize direct publication.

PR #113 restores `npm stage publish` using OIDC, Node 24 and npm 11.15.0,
without broader publisher permissions or a long-lived token. Its final merged
workflow stages only on GitHub Release publication and requires the release
tag/package version and checked-out commit/event SHA to match. This preserves
provenance for the source actually packaged. It does not provide manual staging
or recovery of an old tag.

The failed v0.2.0 release will not be recovered. Its tag and GitHub Release remain
unchanged, and its failed job must not be rerun. v0.2.1 must use a new reviewed,
tested commit after approval and merge. A green staging job registers a candidate;
only an authorized human's approval in npm makes it public.

## Migration from public v0.1.2

- `moura-report/index.html` opens Quality Overview. Requirement Map is at
  `moura-report/moura/index.html`, with source pages under `moura/sources/`.
  The API `outputPath` identifies the Map; `overviewPath` identifies Overview.
- Report output must not already exist, even as an empty directory. Choose a
  fresh `--output` destination; existing reports are rejected without changes.
- `moura report [directory] --output <directory>` accepts project-relative or
  absolute destinations. Validate and check retain their existing CLI behavior.
- `--allure-report <directory>` and `--coverage-report <directory>` copy
  already-generated HTML reports and assets. Moura does not generate those
  external reports. Serve the result over HTTP if a report needs browser fetch.
- `--japanese-views <json>` supplies locally validated translated sources without
  AI credentials or repository development tools. Invalid views are rejected;
  untranslated titles fall back to English.
- Node.js >=24 remains required. After npm approval, install
  `@specxai/moura@0.2.1`; the official Vitest example uses `^0.2.1`.

## Publication and verification gates

Follow [the formal release procedure](releasing.md). Obtain independent PR
review and maintainer approval, merge to main, then confirm Linux and Windows CI,
the main quality-report Pages deployment, and version equality on the exact
merged commit before creating v0.2.1 and its GitHub Release.

GitHub Release publication triggers `npm stage publish`. Review the staged
candidate's name, exact version, source/tag/commit, contents and intended `latest`
dist-tag in npm before a human approves formal publication. Confirm registry
reflection with read-only commands:

```sh
npm view @specxai/moura@0.2.1 version dist.integrity --json
npm view @specxai/moura dist-tags --json
```

After approval and registry reflection, manually run the verification-only
workflow on main:

```sh
gh workflow run publish.yml --repo specxai/moura --ref main \
  -f release_version=0.2.1 -f dist_tag=latest
```

This installs the exact public npm version in a clean official example and checks
CLI version, current-run Allure Evidence, strict traceability, and non-empty
Quality Overview and Requirement Coverage reports. There is no workspace,
tarball or local-dist fallback. Local package/onboarding smokes are preparation
checks and do not establish npm installability. Verification failure does not
roll back publication; investigate approval, propagation, version, dist-tag and
logs rather than rerunning staging.
