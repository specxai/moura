# Moura dogfooding evidence

Moura's complete Vitest suite dogfoods the same Case × verification-layer model
that it offers to projects. Every test in the dedicated Allure run must resolve
through a declared canonical Case to a Scenario and Requirement. This is a
repository invariant, not a general rule that rejects unrelated results in a
user's Allure directory.

The package artifact smoke is deliberately outside normal Vitest discovery. It
requires a pack and clean npm install, so the explicit `pnpm test:package`
command runs it once and writes its successful result to `allure-results` as
Evidence for `REQ-006/SCN-001/CASE-001` and `CASE-002`. The later production
strict check validates and consumes that supplemental Evidence together with
the dedicated Vitest run. A failed smoke removes its prior result and never
emits passing Evidence.

The official onboarding example is also outside normal Vitest discovery and is
run once by the explicit `pnpm test:onboarding` command. Unlike package smoke,
which verifies the packaged CLI and release metadata, onboarding verification
installs the example's public dependencies and executes its Vitest + Allure
configuration, strict check, and Requirement Coverage report end to end. A
successful run writes integration Evidence for the three observable REQ-007
onboarding guarantees; a failed run writes none.

## Mapping rules

- Pass canonical Case IDs such as `REQ-002/SCN-001/CASE-002` to
  `mouraEvidenceName()`; do not pass separate or abbreviated IDs.
- Use the layer where the assertion runs. Tests of a pure function or in-memory
  project model are `unit`; tests that cross a filesystem command/project
  boundary are `integration`.
- Multiple tests should support one Case when they are independent examples of
  the same guarantee. Do not create a Case for each implementation test.
- Multiple Cases may share one result only when every mapped Case is genuinely
  asserted by that test.
- Each test file declares a reviewed default with `mouraEvidenceTest()`. A more
  specific `mouraEvidenceName()` mapping takes precedence. The wrapper also
  covers parameterized tests returned by `it.each()` so newly added tests do
  not silently appear without repository metadata.
- A helper test is mapped to the project-level guarantee it supports, not to a
  manufactured requirement about the helper implementation.

## Reviewed suite mapping

The full-suite reverse audit groups Evidence by the behavior under test:

| Test suite                                | Default guarantee                               | Layer       |
| ----------------------------------------- | ----------------------------------------------- | ----------- |
| `src/project.test.ts`                     | safe, deterministic project-definition parsing  | unit        |
| `src/id.test.ts`                          | valid local and canonical identities            | unit        |
| `src/check.test.ts`                       | deterministic Evidence aggregation              | unit        |
| `src/check-command.test.ts`               | filesystem-boundary check diagnostics           | integration |
| `src/cli.test.ts`                         | CLI routing, arguments, and outcomes            | integration |
| `src/coverage.test.ts`                    | descendant Requirement Coverage roll-up         | unit        |
| `src/report.test.ts`                      | deterministic, filesystem-safe coverage reports | integration |
| `src/adapters/allure.test.ts`             | authoritative Allure Evidence ingestion         | unit        |
| `src/test-support/moura-evidence.test.ts` | canonical dogfooding metadata emission          | unit        |
| `scripts/verify-allure-results.test.ts`   | dogfooding result-metadata audit                | unit        |
| `scripts/verify-allure-report.test.ts`    | generated Behavior hierarchy audit              | unit        |
| `scripts/build-quality-site.test.ts`      | published quality-site assembly                 | integration |
| `scripts/ci-summary.test.ts`              | CI Allure result summary                        | unit        |
| `scripts/run-command.test.ts`             | quality-pipeline command execution              | unit        |

The separate `scripts/package-smoke.ts` command supplies the integration
Evidence for the packaged-consumer guarantee; it is not part of the reviewed
Vitest-suite table above.

Likewise, `scripts/onboarding-example.ts` supplies integration Evidence for
`REQ-007/SCN-001/CASE-001` through `CASE-003` only after the external-style
example flow succeeds. Keeping both explicit commands out of default Vitest
discovery prevents package installation from recurring in `pnpm test`,
`test:coverage`, or `test:allure`.

Focused tests in the project, check, check-command, and Allure adapter suites
retain explicit mappings to the narrower existing Cases they directly prove.
Thus the default is not an escape hatch or a title allowlist: it is Evidence for
a documented suite-level guarantee, overridden where a more precise contract
applies.

## Repository self-audit

`pnpm test:allure` deletes and regenerates `allure-results`. The test helper
marks each result with `moura_traceability=managed`, validates every mapping
against `moura.yaml`, and then rejects any generated Vitest result that has no
authoritative Moura Evidence metadata. This repository-only audit remains an
early, focused check of generated metadata and manifest mappings.

After the result audit, `node dist/cli.js check .` consumes those same files
through Moura's production Allure adapter and core verification path. It
remains responsible for completeness and the existing `PASS`, `SKIPPED`,
`UNIMPLEMENTED`, `MISSING`, `FAIL`, and `BROKEN` status/severity semantics.

CI invokes that production path as `node dist/cli.js check .
--strict-traceability`, so a future managed result that loses its Case mapping
also fails as an `UNMAPPED` error. The two checks keep distinct responsibilities:
the repository audit validates generated dogfooding metadata immediately,
whereas strict checking exercises the public adapter, shared evaluation,
diagnostic rendering, and exit behavior. Ordinary unmarked results in a user's
mixed Allure directory remain out of scope.

`pnpm report:allure` generates a report from the dedicated `allure-results`
directory only. Its verifier walks the complete Behavior tree, requires every
expected test leaf at exactly Requirement → Scenario → Case → Test depth, and
rejects root-level or partially grouped test leaves. This complements the
result audit by checking presentation rather than treating Behavior labels as
Evidence authority.

Moura's `moura_requirement`, `moura_scenario`, `moura_case`, and `moura_layer`
labels remain the authoritative machine-readable contract. Allure `epic`,
`feature`, and `story` labels are presentation only. For a multi-Case result,
all authoritative tuples remain ordered while the first declared Case is
projected deterministically into the Behavior hierarchy.
