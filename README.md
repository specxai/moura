# Moura

Moura is an open-source, Git-native CLI for checking traceability between requirements, specifications, and test evidence, and for reporting verification coverage. It does not own the requirements or specifications: it connects the documents already reviewed in Git with evidence produced by test tools.

> **Status:** Moura is in early development. Static project validation, Allure-backed evidence checking, and static Requirement Coverage reporting from the current project model and evidence are available.

## First run

A Moura project contains `moura.yaml` plus the Requirement and Specification
Markdown files named by that manifest. The runnable
[`examples/vitest-minimal`](examples/vitest-minimal/README.md) project is the
shortest complete onboarding path. Follow it from top to bottom to:

1. confirm Node.js 24 or newer;
2. install Moura as a local development dependency;
3. create `moura.yaml`;
4. write Requirement Markdown;
5. write Specification Markdown;
6. run `moura validate`;
7. configure Vitest with the Allure reporter;
8. add authoritative Moura metadata to a test;
9. run the test and generate `allure-results` JSON;
10. run `moura check --strict-traceability`;
11. run `moura report`; and
12. open `moura-report/index.html`.

In an existing Node.js 24+ project, install the packages locally and validate
the structure with:

```sh
npm install --save-dev @specxai/moura vitest allure-vitest allure-js-commons
npx moura validate .
```

Tests expose the local IDs in a canonical Case path as separate Allure labels,
plus one `moura_layer` label:

```ts
await allure.label("moura_traceability", "managed");
await allure.label("moura_requirement", "REQ-001");
await allure.label("moura_scenario", "SCN-001");
await allure.label("moura_case", "CASE-001");
await allure.label("moura_layer", "unit");
```

The example shows the direct Allure API and the presentation-only
`epic`/`feature`/`story` hierarchy in executable context.

After the tests have written `allure-results/`, run `moura check`. Success means there are no error-severity pairs and no malformed or semantically
invalid evidence. Explicit warning states remain visible but do not fail the check. **`moura check` consumes existing evidence; it does not execute
the user's tests.** See [the check contract](docs/check.md) for details.

```sh
npm test
npx moura check . --strict-traceability
npx moura report .
```

`MISSING` means a manifest-required Case × layer has no Evidence and is always
an error. `UNMAPPED` means a managed result lacks authoritative Moura mapping;
it warns by default and is an error under `--strict-traceability`.

## Why Moura?

Teams often keep requirements, detailed behavior, and test results in separate formats. It can then be difficult to answer whether every specified case has evidence at every required verification layer. Moura aims to answer that question deterministically without introducing another system of record or requiring AI.

Its operating principles are:

- **No server** — analysis runs locally or in CI.
- **No database** — no separate traceability store must be operated.
- **Git is the source of truth** — reviewed files define the current specification.
- **Tool-neutral core** — evidence adapters translate external results; the core does not depend on Allure or another report format.
- **Deterministic first** — v0.1 focuses on static validation and aggregation. Optional AI-assisted gap suggestions may be added later.

## Traceability model

Moura uses three domain roles:

```text
Requirement
  └ Scenario
      └ Case
```

A **local ID** identifies a node among its siblings. The v0.1 convention is `REQ-001`, `SCN-001`, and `CASE-001`, but the model does not embed those prefixes or a three-digit rule. Local IDs must be non-empty and cannot contain `/`, Unicode whitespace, Unicode control code points (`General_Category=Cc`), or unpaired UTF-16 surrogates. Verification-layer names share the latter two interoperability restrictions; ordinary printable and supplementary Unicode remain supported.

Moura derives a logical **canonical ID** from the hierarchy:

```text
REQ-001
REQ-001/SCN-001
REQ-001/SCN-001/CASE-001
```

Canonical IDs are identities, not paths or prescribed filenames. Reparenting a node changes its canonical ID and therefore creates a different logical node.

The smallest coverage point is a canonical Case ID plus an open-ended verification-layer string, such as `REQ-001/SCN-001/CASE-001 + integration`. Tests and Cases have a many-to-many relationship; Moura does not require a proprietary test ID.

See [Concepts](docs/concepts.md), the [v0.1 traceability specification](docs/config.md), the [initial evidence-checking contract](docs/check.md), and the [ID model](docs/id-model.md) for the authoritative details.

## Traceability manifest

`moura.yaml` records relationships and required verification layers. Descriptions, boundary values, and expected behavior remain in requirement and specification documents rather than being duplicated into YAML.

```yaml
version: 1

sources:
  requirements:
    - req.md
  specifications:
    - spec.md

verification:
  layers:
    - unit
    - integration

requirements:
  - id: REQ-001
    scenarios:
      - id: SCN-001
        cases:
          - id: CASE-001
            verify:
              - unit
              - integration
          - id: CASE-002
            unimplemented:
              - integration
```

`verify` requires Evidence; `unimplemented` explicitly records, in Git, that a Case × layer verification does not exist yet. Evidence absent from a `verify` pair is always `MISSING`—leaving it blank never implies `UNIMPLEMENTED`.

Canonical IDs are intentionally omitted and derived from the nesting. Layer names are strings rather than a closed enum, allowing domains to use values such as `contract`, `security`, `manual`, `sil`, or `vehicle`. The repository's own [`moura.yaml`](moura.yaml), [`req.md`](req.md), and [`spec.md`](spec.md) are the primary real-world example; see the [v0.1 contract](docs/config.md).

## CLI

The npm package is `@specxai/moura`, and its installed executable remains
`moura`. From a project directory, the main commands are:

```sh
moura validate .
moura check .
moura report .
```

```sh
moura validate [directory] # validate moura.yaml and its configured Markdown sources
moura check [directory]    # check existing Allure evidence
moura report [directory]   # write <project>/moura-report/index.html
```

All commands use the current working directory by default, or a supplied relative or absolute project directory. `moura check` first validates the project, then consumes existing evidence from `<project>/allure-results/`; it does not run tests or generate evidence. Every Case × verification-layer point must have success or warning severity, with no adapter or semantic evidence issues, for the check command to succeed. `PASS` is success; `SKIPPED` and `UNIMPLEMENTED` are warnings; `FAIL`, `BROKEN`, and `MISSING` are errors. `moura report` consumes the same structured result and produces deterministic static HTML without running tests.

Allure results associate evidence using one or more ordered `moura_requirement`, `moura_scenario`, and `moura_case` local-ID triples and exactly one `moura_layer` label. Moura reconstructs canonical Case IDs at the adapter boundary. See the [Allure evidence adapter contract](docs/check.md#allure-evidence-adapter) for supported statuses and input details.

For browsing, Moura also projects a canonical Case ID into Allure's standard
Behavior hierarchy: Requirement → `epic`, Scenario → `feature`, and Case →
`story`. These labels are presentation-only. The `moura_*` labels above remain
the authoritative evidence metadata consumed by Moura; the adapter never
reconstructs evidence from `epic`, `feature`, or `story`.

## Development

Moura starts as a small Node.js 24+ and TypeScript project.

```sh
pnpm install
pnpm lint
pnpm lint:fix
pnpm format
pnpm format:check
pnpm typecheck
pnpm test # run the TypeScript test suite with Vitest
pnpm test:coverage # run tests and create coverage HTML/JSON/LCOV
pnpm test:allure # run the same suite and verify generated Allure results
pnpm test:onboarding # install and execute the public Vitest + Allure example
pnpm report:allure # create static Allure Report 3 HTML from allure-results
pnpm build && pnpm report:moura # create static Requirement Coverage HTML
```

`pnpm test` is the fast local test command and does not create persistent test
results. `pnpm test:allure` writes `allure-results/` with the official Vitest
integration, then checks the emitted Moura metadata. Moura targets Allure Report
3+. Report generation remains a separate command so existing result validation
and static HTML generation have clear responsibilities. `pnpm report:allure`
loads `allurerc.ts`, which configures the Awesome report tree to group by
`epic` → `feature` → `story`, and verifies a representative generated tree.

The repository annotates real validation and checking tests to dogfood its declared verification contract. These declarations are reviewed mappings to test behavior; Moura never synthesizes passing evidence. See the [dogfooding evidence mapping](docs/dogfooding.md) for the mapping rules and the current Case × layer inventory.

Evidence-producing tests use the Moura-owned custom Allure labels
`moura_requirement`, `moura_scenario`, `moura_case`, and `moura_layer`. They are
not built-in Allure identity or suite semantics: aligned hierarchy label values
map to canonical IDs in `Evidence.covers[]`, while exactly one `moura_layer`
label maps to `Evidence.layer`. Case IDs and layer values must come from `moura.yaml` and obey
the same identifier/layer character contract. Invalid identity labels are
reported as evidence-input errors and do not produce normalized evidence.

Allure Report 3.17.0 builds each Behavior level from all values of a repeated
label. Repeating `epic`, `feature`, and `story` for a multi-case result therefore
creates a Cartesian product and loses the original Case tuple association. To
avoid displaying false paths, `mouraEvidenceName()` deterministically projects
only the first declared Case into the Behavior hierarchy. It still emits every
ordered Case tuple as authoritative `moura_*` metadata, so evidence checking is
unchanged and complete.

The executable exposes `validate`, `check`, `report`, version, and help commands. Domain types, coverage aggregation, report rendering, and canonical-ID construction are also exported for integrations.

## Quality reports

Latest successful `main` branch reports:

- [Requirement Coverage](https://specxai.github.io/moura/moura/)
- [Allure Report](https://specxai.github.io/moura/allure/)
- [Code coverage](https://specxai.github.io/moura/coverage/)

Requirement Coverage rolls up authoritative pair results: only `PASS` is covered; every required layer must pass for a Case, every Case for a Scenario, and every Scenario for a Requirement. `FAIL`, `BROKEN`, `SKIPPED`, `UNIMPLEMENTED`, and `MISSING` remain visible gaps; warnings and errors are visually distinct. **Moura verifies declared traceability and its evidence; it does not prove that a test semantically verifies the specification it declares.**

These static reports are produced by CI; pull requests retain their reports as
workflow artifacts without replacing the public site.

## License

Licensed under the existing [Apache License 2.0](LICENSE).
