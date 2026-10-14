# Moura 0.2.0

Release notes prepared for review; this change does not publish a release.

Moura 0.2.0 adds portable Quality Overview reports for external projects,
optional Allure and coverage HTML integration, and improved Requirement Map
navigation and Evidence details. Validated Japanese views can be supplied
locally, without AI credentials or repository development tools.

## Migration from 0.1.2

- `moura-report/index.html` now opens Quality Overview. Requirement Map is at
  `moura-report/moura/index.html`, with source pages under `moura/sources/`.
  The API `outputPath` still identifies the Map; `overviewPath` identifies Overview.
- Report output must not already exist, even as an empty directory. Choose a
  fresh `--output` destination; existing reports are rejected without changes.
- `moura report [directory] --output <directory>` accepts project-relative or
  absolute destinations. Validate and check retain their existing CLI behavior.
- Add `--allure-report <directory>` and `--coverage-report <directory>` to copy
  already-generated HTML reports and assets. Moura does not generate these
  external reports. Serve the result over HTTP if a report needs browser fetch.
- Node.js >=24 remains required.

## Version decision

The current npm `latest` and newest GitHub Release are 0.1.2. The report entry
point and output reuse behavior change alongside new report CLI features. A
pre-1.0 minor release, 0.2.0, communicates this compatibility impact better
than another 0.1 patch. No stricter version policy is documented.

## Publication gate

Merge only after PR CI and the repository-required fresh independent review.
Before a separately authorized publication, recheck main CI and Pages, ensure
package and CLI versions match, and confirm npm Trusted Publisher configuration
for `.github/workflows/publish.yml`. Publishing a GitHub Release triggers npm
publication; do not use that event merely to preview these notes. Follow
[the release procedure](releasing.md).
