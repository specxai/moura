# Specification

## REQ-001

### SCN-001 Validate a traceability definition

#### CASE-001 Accept a structurally valid definition

A definition that satisfies the v0.1 manifest, source, hierarchy, identity, and verification-layer rules is valid.

#### CASE-002 Reject an unsupported or missing manifest version

Validation fails when `version` is absent or is not a supported version.

#### CASE-003 Reject an unavailable source file

Validation fails when a configured requirement or specification source does not exist or cannot be read.

#### CASE-004 Reject a missing source node or invalid hierarchy

Validation fails when a manifest Requirement is absent from requirement sources, or a manifest Scenario or Case is absent beneath its expected ancestors in specification sources.

#### CASE-005 Reject a duplicate Requirement ID

Validation fails when a Requirement local ID occurs more than once in the project.

#### CASE-006 Reject a duplicate Scenario ID within a Requirement

Validation fails when a Scenario local ID occurs more than once under the same Requirement.

#### CASE-007 Reject a duplicate Case ID within a Scenario

Validation fails when a Case local ID occurs more than once under the same Scenario.

#### CASE-008 Reject an invalid local ID

Validation fails when a local ID is empty; contains `/` or a Unicode
`White_Space` character; contains a Unicode control code point whose
`General_Category` is `Cc`; or contains an unpaired UTF-16 surrogate code unit.
Ordinary printable and supplementary Unicode code points remain valid and are
not normalized.

#### CASE-009 Reject an incomplete hierarchy

Validation fails when a Requirement has no Scenario or a Scenario has no Case.

#### CASE-010 Reject a Case without a verification layer

Validation fails when a Case declares no verification layer: both `verify` and
`unimplemented` are absent or empty. A Case is valid when at least one of the
two lists contains a layer, including when `unimplemented` is the only
non-empty list.

#### CASE-011 Reject an unknown or duplicate verification layer

Validation fails when a Case references a layer absent from
`verification.layers`; repeats a layer within either its `verify` or
`unimplemented` list; or declares the same layer in both lists.
Layer names are also invalid when they contain a Unicode `Cc` control code point
or an unpaired UTF-16 surrogate; valid surrogate pairs remain supported.

#### CASE-012 Reject a duplicate canonical ID

Validation fails when derived canonical IDs are not unique.

#### CASE-013 Reject an unmanaged Markdown ID

Validation fails when a Moura-managed Requirement, Scenario, or Case ID is present in a configured Markdown source but absent from the manifest.

#### CASE-014 Parse project definitions safely and deterministically

Manifest YAML and Markdown sources are interpreted without executable YAML
features, with exact source identities and Markdown structure preserved.
Malformed, ambiguous, unsafe, or independently invalid inputs produce stable,
source-aware diagnostics; valid project-relative inputs produce the same
hierarchy regardless of irrelevant document content.

## REQ-002

### SCN-001 Evaluate required Case × verification-layer evidence

#### CASE-001 Pass when required evidence passes

A required Case × layer pair is `PASS` when at least one matching record is passed and no matching record is failed or broken.

#### CASE-002 Report missing evidence

A required Case × layer pair is `MISSING` when no evidence matches its canonical Case ID and layer.

#### CASE-003 Fail when matching evidence fails

A required Case × layer pair is `FAIL` when any matching record is failed. Failure dominates broken, passed, and skipped records.

#### CASE-004 Treat skipped-only evidence as skipped

A required Case × layer pair is `SKIPPED` when matching evidence exists but every matching record is skipped.

#### CASE-005 Aggregate multiple records and layers deterministically

Multiple records are aggregated independently of input order using the precedence `FAILED > BROKEN > PASSED > SKIPPED`. Passed plus skipped is `PASS`; broken plus passed or skipped is `BROKEN`; any set containing failed, including failed plus broken, is `FAIL`; and multiple passed records are `PASS`. Each required layer is evaluated independently, and results retain Requirement → Scenario → Case → verify-layer manifest order.

#### CASE-006 Reject invalid canonical evidence targets

Evidence checking fails and reports evidence that has no target, refers to an unknown canonical ID, or targets a Requirement or Scenario. Initial evidence coverage targets Cases only and uses Moura's derived canonical IDs without interpreting ID prefixes.

#### CASE-007 Reject invalid verification layers

Evidence checking fails and reports evidence using a layer not declared by the project or not required by its covered Case.

#### CASE-008 Treat broken evidence as broken

A required Case × layer pair is `BROKEN` when at least one matching record is broken and no matching record is failed. Broken dominates passed and skipped records: broken alone, broken plus passed, and broken plus skipped are `BROKEN`, while failed plus broken is `FAIL`.

#### CASE-009 Separate verification status from project severity

`PASS` has success severity; `SKIPPED` and explicitly declared `UNIMPLEMENTED`
have warning severity; and `FAIL`, `BROKEN`, and `MISSING` have error severity.
A project passes with success and warning entries only, but fails when any error
or evidence-validation issue exists.

#### CASE-010 Represent unimplemented verification explicitly

A Case may declare a layer in `unimplemented` instead of `verify`. This
Git-reviewed Case × layer declaration produces `UNIMPLEMENTED` without
Evidence. Omitting both a declaration and required Evidence never implies
`UNIMPLEMENTED`; a `verify` pair without Evidence remains `MISSING`. A layer
cannot appear in both lists, and Evidence for an unimplemented pair is a
contradiction that fails checking.

#### CASE-011 Surface status and severity through the CLI and report

The check CLI and Requirement Coverage report preserve every verification
status and identify its success, warning, or error severity. Warning-only
checks exit successfully; errors and evidence-validation issues do not.
Reverse-traceability `UNMAPPED` diagnostics remain separate from pair statuses
and coverage: they warn by default and become errors only when strict
traceability is requested.

## REQ-003

### SCN-001 Invoke Moura from the command line

#### CASE-001 Route commands, directories, arguments, and process outcomes

The CLI operates on the current directory or an explicitly selected project,
lists its commands, preserves version behavior, rejects invalid commands and
extra arguments, and returns a non-zero outcome for structural, Evidence, or
filesystem failures.

### SCN-002 Produce verification diagnostics and reports

#### CASE-001 Diagnose project checks at the filesystem boundary

Checking a project loads its configured Allure results, distinguishes missing
Evidence from unavailable or malformed result storage, stops on invalid
project structure, and renders semantic Evidence issues with their source and
layer context.

#### CASE-002 Calculate Requirement Coverage from descendant Evidence

A Case is covered only when all of its required verification pairs pass; a
Scenario or Requirement is covered only when all descendants are covered.

#### CASE-003 Generate a deterministic and filesystem-safe coverage report

Requirement Coverage output preserves hierarchy, identities, statuses,
severities, gaps, and diagnostics with safe HTML escaping. Regeneration
replaces stale, hard-linked, or symlinked output entries without modifying or
deleting targets outside the generated report.

## REQ-004

### SCN-001 Read Moura Evidence from Allure results

#### CASE-001 Reconstruct authoritative Case and layer tuples

Moura reads supported Allure statuses and reconstructs ordered, de-duplicated
canonical Case identities positionally from `moura_requirement`,
`moura_scenario`, and `moura_case`, together with exactly one `moura_layer`.
Malformed or ambiguous authoritative metadata yields deterministic issues;
Behavior labels are ignored for reconstruction and results without Moura
labels remain outside verification scope unless explicitly marked with
`moura_traceability=managed`. A marked result without authoritative mapping is
reported as `UNMAPPED`; partial authoritative metadata remains invalid Evidence.

#### CASE-002 Load result files deterministically

Only Allure `*-result.json` files are loaded, in stable filename order, and
malformed JSON is reported with its source filename.

## REQ-005

### SCN-001 Produce complete Moura dogfooding Evidence

#### CASE-001 Emit canonical metadata for every Moura Vitest test

The dedicated Moura Allure run gives every Vitest result at least one declared
canonical Case and one required verification layer. It emits authoritative
`moura_requirement`, `moura_scenario`, `moura_case`, and `moura_layer` labels;
multi-Case results preserve every authoritative tuple while deterministically
projecting the first tuple to Allure's Behavior hierarchy.

#### CASE-002 Reject invalid or incomplete dogfooding metadata

Moura's repository-level result audit rejects missing, malformed, ambiguous,
unknown, or non-required Case × layer metadata in the dedicated dogfooding
run, while the reusable validator continues to permit unrelated Allure results
outside that repository invariant.

### SCN-002 Verify and publish Moura quality results

#### CASE-001 Verify the generated Allure hierarchy

The generated Allure Behavior report contains a Requirement → Scenario → Case
→ Test path for Moura tests and contains no root-level test caused by missing
traceability metadata.

#### CASE-002 Assemble the published quality site

The quality site publishes Requirement Coverage, Allure, and code-coverage
reports with stable destinations, repository identity, and commit identity.

#### CASE-003 Summarize generated test results for CI

CI summary generation counts only Allure result files by supported status and
reports malformed files or unsupported statuses rather than silently
misstating results.

#### CASE-004 Execute quality pipeline commands without argument loss

Quality-pipeline command execution preserves argument boundaries and captured
output and reports both process failures and spawn failures with actionable
context.

## REQ-006

### SCN-001 Use the documented public traceability contract

#### CASE-001 Process a documented project through the packaged CLI

In a clean consumer installation, the packaged CLI accepts managed Allure
Evidence whose authoritative mapping is expressed by separate
`moura_requirement`, `moura_scenario`, `moura_case`, and `moura_layer` labels.
It validates the documented minimal project, checks its Evidence, and generates
a non-empty Requirement Coverage report without importing repository source.

#### CASE-002 Keep package and CLI release identities consistent

The package artifact retains the declared package name, version, and `moura`
binary mapping, and the installed CLI reports the same version as the artifact.
Registry release verification reads the selected npm dist-tag as a literal key,
including when its valid name contains periods.

## REQ-007

### SCN-001 Use the official Vitest and Allure onboarding example

#### CASE-001 Produce Allure Evidence through the public integration

The official minimal example installs only public packages, runs Vitest with
the public Allure reporter and direct Allure API, and produces result JSON with
managed authoritative Moura labels and the presentation-only Requirement →
Scenario → Case Behavior hierarchy.

#### CASE-002 Pass strict Moura verification

Before every test execution, the example removes prior Allure results using a
cross-platform Node.js filesystem API. A run without current Evidence reports
MISSING rather than passing from stale Evidence; generated current-run Evidence
validates and passes `moura check --strict-traceability` without relying on
Moura's internal dogfooding helpers.

#### CASE-003 Generate Requirement Coverage

The verified example generates a non-empty `moura-report/index.html` containing
its canonical Case identity.
