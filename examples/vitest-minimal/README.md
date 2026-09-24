# Minimal Vitest + Allure onboarding

This runnable project shows the complete public Moura flow without importing
anything from the Moura repository. It requires Node.js 24 or newer.

## Run it

Starting in this directory, run each command in order:

```sh
node --version
npm install
npx moura validate .
npm test
test -n "$(find allure-results -name '*-result.json' -print -quit)"
npx moura check . --strict-traceability
npx moura report .
```

Then open `moura-report/index.html`. `npm test` runs Vitest; the configured
`allure-vitest` reporter writes machine-readable Allure result JSON to
`allure-results/`. That directory is Moura's Evidence input. It is **not** an
Allure HTML report. Generating an optional Allure HTML report is a separate
Allure operation and is not needed by `moura check` or `moura report`.

The project files make every setup step explicit:

1. [`package.json`](package.json) installs Moura locally as a development
   dependency together with Vitest, `allure-vitest`, and the direct
   `allure-js-commons` API used by the test.
2. [`moura.yaml`](moura.yaml) connects the Requirement, Specification, required
   Case, and `unit` verification layer.
3. [`requirements.md`](requirements.md) and
   [`specification.md`](specification.md) define the Markdown hierarchy.
4. [`vitest.config.ts`](vitest.config.ts) configures the Allure reporter and its
   `allure-results` destination.
5. [`test/add.test.ts`](test/add.test.ts) adds metadata through the direct Allure
   API and asserts the behavior.

The `moura_*` labels are the authoritative mapping consumed by Moura.
`moura_traceability=managed` says that the result is intended to be mapped;
`moura_requirement`, `moura_scenario`, and `moura_case` identify its Case; and
`moura_layer` identifies the verification layer. The parallel `epic`,
`feature`, and `story` labels present Requirement → Scenario → Case in Allure,
but are presentation-only and are never used by Moura as authoritative data.

## Diagnosing gaps

- **MISSING** means a Case × layer required by `verify` in `moura.yaml` has no
  Evidence. It is always an error.
- **UNMAPPED** means a result marked `moura_traceability=managed` lacks an
  authoritative mapping. It is a warning by default and an error with
  `--strict-traceability`.

Fix either condition in the manifest/test relationship; do not weaken the
strict command or substitute `epic`/`feature`/`story` for authoritative labels.
