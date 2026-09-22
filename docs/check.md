# Initial evidence-checking contract

This document defines the initial, framework-independent contract for `moura check`. It is separate from [v0.1 structural validation](config.md): `moura validate` establishes that the traceability definition is valid, while checking determines whether every required Case × verification-layer pair has acceptable evidence.

## Boundary and data model

The pure check core receives an already structurally valid `MouraManifest` and normalized `Evidence[]`. Structural errors must be reported before the core is called; evidence checking neither repairs nor replaces validation.

Each evidence record:

- covers one or more canonical Case IDs derived from the existing Requirement → Scenario → Case tree;
- belongs to exactly one project-declared verification layer;
- has the explicit status `passed`, `failed`, `broken`, or `skipped`; and
- may retain optional, adapter-neutral source metadata, which does not affect aggregation.

Initial evidence is Case-only. Requirement and Scenario IDs are not accepted as coverage targets, and Moura does not infer node kinds from ID prefixes. Evidence with no targets, an unknown canonical ID, a Requirement or Scenario ID, an undeclared layer, or a Case/layer pair not required by that Case is reported as invalid and makes the project check fail. It is never silently ignored. Duplicate valid evidence records receive no special treatment; they participate in normal aggregation.

The normalized model and aggregation have no Allure, JUnit XML, test-runner, or CI-provider semantics. Adapters translate their native formats into this framework-independent model before invoking the check core.

## Pair aggregation

Evidence matches a required pair only when `covers` contains that pair's canonical Case ID and `layer` equals its verification layer. Every layer in a Case's `verify` list creates an independent evidence-required pair. Every layer in `unimplemented` creates an explicit `UNIMPLEMENTED` pair for which Evidence is not expected. Evidence targeting such a pair is a contradictory semantic issue; it never overrides the manifest.

For all matching evidence, apply this precedence:

1. no records → `MISSING`;
2. any `failed` record → `FAIL`;
3. otherwise, any `broken` record → `BROKEN`;
4. otherwise, any `passed` record → `PASS`;
5. otherwise → `SKIPPED`.

Consequently, precedence is `FAILED > BROKEN > PASSED > SKIPPED`: passed plus skipped is `PASS`, broken plus passed or skipped is `BROKEN`, and any combination containing failed is `FAIL`. This rule is independent of evidence order.

`UNIMPLEMENTED` does not participate in Evidence aggregation: it comes only from the manifest. No Evidence for a `verify` pair is always `MISSING`, never inferred as `UNIMPLEMENTED`.

## Status and severity

| Status          | Severity | Meaning                                                                                 |
| --------------- | -------- | --------------------------------------------------------------------------------------- |
| `PASS`          | success  | acceptable passing Evidence exists                                                      |
| `SKIPPED`       | warning  | Evidence exists and every matching result was explicitly skipped                        |
| `UNIMPLEMENTED` | warning  | the manifest explicitly declares that this Case × layer verification is not implemented |
| `FAIL`          | error    | at least one matching result failed                                                     |
| `BROKEN`        | error    | at least one matching result is broken and none failed                                  |
| `MISSING`       | error    | Evidence was required by `verify`, but none exists                                      |

Status and severity are separate. Warning statuses remain `SKIPPED` or `UNIMPLEMENTED`; they are not converted to `PASS`. A project passes when it has no error entries and no adapter or semantic evidence issues.

## Structured result and ordering

The check result contains one structured entry per declared pair with its canonical Case ID, layer, status (`PASS`, `FAIL`, `BROKEN`, `MISSING`, `SKIPPED`, or `UNIMPLEMENTED`), and severity. It also contains deterministic evidence issues and a project-level `passed` value. Entries retain manifest order: Requirement, then Scenario, then Case, then the Case's `verify` layers followed by its `unimplemented` layers. Adapter or evidence ordering never changes entry order or aggregation.

The project passes when every pair has success or warning severity, there are
no evidence issues, and there are no error-severity reverse-traceability
diagnostics.

## Reverse traceability and UNMAPPED

Pair aggregation answers **Specification → Test**: when a required Case ×
layer has no Evidence, its status is `MISSING` and its severity is always
error. Reverse traceability answers **Test → Specification**. An in-scope test
result with no authoritative Case mapping produces the separate `UNMAPPED`
diagnostic. It is not a `VerificationCheckStatus`, does not create or alter a
Case × layer entry, and does not affect Requirement Coverage counts.

Traceability scope is explicit and result-level. An Allure result is managed
when it contains the label `moura_traceability=managed`. A managed result with
none of the four authoritative mapping labels is `UNMAPPED`. Results without
that marker and without authoritative labels remain unrelated and out of scope,
so mixed Allure directories remain backward compatible. There are no test-name,
file-name, directory-name, or internal-suite heuristics.

The authoritative mapping labels remain `moura_requirement`,
`moura_scenario`, `moura_case`, and `moura_layer`. Standard Allure Behavior
labels (`epic`, `feature`, and `story`) are presentation only; a managed result
with only Behavior labels is therefore `UNMAPPED`. A result containing any
authoritative label is instead processed as Evidence: partial metadata remains
an adapter issue, while complete metadata with an unknown Case or invalid layer
remains a semantic Evidence issue. Neither is reclassified as `UNMAPPED`.

`UNMAPPED` has warning severity by default and alone does not fail `moura
check`. `moura check [directory] --strict-traceability` promotes only this
diagnostic to error and makes the check exit nonzero. Existing status severities
are unchanged. Diagnostics retain the test name and result filename and follow
the loader's deterministic filename order. Requirement Coverage reports use the
same project evaluation and show reverse-traceability diagnostics in a section
separate from pair coverage.

## CLI flow

`moura check [directory] [--strict-traceability]`:

1. structurally validate the project;
2. load normalized evidence through a narrow adapter boundary;
3. invoke the pure check core;
4. render deterministic results; and
5. exit `0` only when the project check passes.

Any `FAIL`, `BROKEN`, `MISSING`, invalid evidence, or structural validation error results in exit `1`. `SKIPPED` and `UNIMPLEMENTED` are warnings and do not by themselves cause failure. The directory defaults to the current working directory. Evidence is consumed from `<project>/allure-results/`; the command does not run tests or create evidence. A missing or unreadable results directory is an adapter input failure, while a readable directory with no matching evidence produces `MISSING` entries.

Each declared pair is printed as `<STATUS> <canonical Case ID> [<layer>] (<severity>)`. Adapter issues and semantic evidence issues are reported separately. The command succeeds when no entry has error severity and neither kind of issue exists.

## Allure evidence adapter

The public Allure adapter reads the small structural subset of Allure result JSON that Moura needs; parsing does not require Allure runtime libraries. Only `*-result.json` files are discovered by the directory loader, in deterministic filename order. Unmarked results without authoritative Moura labels are unrelated and ignored; explicitly managed results without them produce `UNMAPPED`. Partially or incorrectly labelled results produce structured adapter issues that remain distinct from semantic `EvidenceIssue`s.

Custom labels and statuses map as follows:

| Allure input                                                          | Normalized Moura field |
| --------------------------------------------------------------------- | ---------------------- |
| ordered `moura_requirement` + `moura_scenario` + `moura_case` triples | `Evidence.covers[]`    |
| exactly one `moura_layer` label                                       | `Evidence.layer`       |
| `passed`                                                              | `passed`               |
| `failed`                                                              | `failed`               |
| `broken`                                                              | `broken`               |
| `skipped`                                                             | `skipped`              |
| `unknown`                                                             | invalid adapter input  |

Each hierarchy value is a local ID: for example, `moura_requirement=REQ-002`, `moura_scenario=SCN-001`, and `moura_case=CASE-002`. The adapter joins these values into the internal canonical ID `REQ-002/SCN-001/CASE-002`. Every `moura_layer` value must satisfy the verification-layer string-safety contract: it contains neither a Unicode `General_Category=Cc` control code point nor an unpaired UTF-16 surrogate. Invalid identity labels are adapter-input errors; the result produces no normalized evidence, and diagnostics identify the field and result source without reproducing the unsafe value.

For multi-case evidence, each label kind has the same number of values and values at the same position form a hierarchy triple. Producers repeat a shared Requirement or Scenario when necessary; this prevents ambiguous cross-products between unrelated hierarchy components. Repeated identical reconstructed canonical IDs are de-duplicated while preserving their first-seen order. Missing, invalid, or unequal label sequences produce adapter issues and no evidence. The caller-supplied source, or the result filename when loading a directory, is retained as adapter-neutral `Evidence.source` and does not affect aggregation. Whether a well-formed canonical Case ID or layer is declared by the validated project remains the responsibility of `checkVerification()` rather than the Allure-format adapter.

The test helper also derives Allure's standard Behavior labels from the same
parsed canonical ID: Requirement → `epic`, Scenario → `feature`, and Case →
`story`. This is a presentation projection only. Allure Report 3.17.0 treats
repeated values at successive Behavior levels as independent sets, producing
their Cartesian product rather than preserving aligned tuples. Consequently,
for multi-case evidence the helper deterministically projects only the first
declared Case into Behavior labels. It continues to emit all ordered `moura_*`
triples, and this adapter ignores Behavior labels even when they are absent,
duplicated, or inconsistent with the authoritative metadata.

## Requirement Coverage report

After evidence exists, `moura report [directory]` writes `<project>/moura-report/index.html`. The static report consumes the same validated manifest, normalized evidence, and `checkVerification()` result as `moura check`; it does not parse Allure or reproduce pair-status precedence.

`moura-report/` is generated output owned and managed by Moura. Running `moura report` may delete and recreate the entire directory, so do not place files there that you want to preserve.
Moura assumes no concurrently malicious process mutates the validated project directory while report output is being recreated; defending against such races is outside its filesystem threat model.

A required Case × layer pair is covered only when it is `PASS`. A Case is fully verified only when every required layer is `PASS`; a Scenario only when every Case is fully verified; and a Requirement only when every Scenario is fully verified. Project and per-layer counts use the same rule. `FAIL`, `BROKEN`, `SKIPPED`, `UNIMPLEMENTED`, and `MISSING` are distinct gaps, with warning and error severity shown separately.

Moura verifies declared traceability and its evidence; it does not prove that a test semantically verifies the specification it declares. Reviewers remain responsible for ensuring each `covers` declaration truthfully represents the test behavior.
