# Changelog

## Unreleased — Report CLI v2

- `moura report [directory] --output <directory>` accepts project-relative and
  absolute destinations. Validate/check arguments and behavior are unchanged.
- **The top-level `moura-report/index.html` is now Quality Overview.** Requirement
  Map moves to `moura-report/moura/index.html`; REQ/Spec HTML moves to
  `moura-report/moura/sources/`. Open the existing top-level path to reach the
  Overview and navigate to the Map. The public API's `outputPath` continues to
  identify the Map; `overviewPath` identifies Overview.
- Overview evaluation/rendering and Japanese-view integrity validation ship in
  the npm package and are shared with Moura's own Quality Site. Node.js >=24
  remains required. No AI/API key, dev tooling, or hosting URL is required.
- Optional Allure results and coverage summary contribute metrics without
  generating/copying external HTML or linking to absent report artifacts.
- `--japanese-views <json>` explicitly configures locally validated translated
  sources. Untranslated titles fall back to English; invalid views are rejected.
- Report output must not exist: existing files and directories, including empty
  directories and previous reports, are rejected without changes. Remove output
  yourself or choose a new path before regeneration. Ownership metadata, hash
  matching, updates and backups are no longer used. Private staging, exclusive
  creation, umask permissions and protected-input/symlink checks remain.

Future issue candidates: opt-in external HTML report bundling with portable
asset/link handling, and configurable external metric input locations. These
are separate from v2's required portable report generation.
