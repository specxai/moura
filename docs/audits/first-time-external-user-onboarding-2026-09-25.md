# First-time external-user onboarding audit (2026-09-25)

## 1. Audit baseline

- Audited commit: `867643ec6b08bf1b031ffe1338190968de7d3945`
  (`Add runnable Vitest + Allure onboarding example (external-user flow) (#72)`).
- The commit matched the latest fetched `main` at the start of the audit.
- The audit used only the public README, documentation, official example, and
  npm artifact when evaluating the external-user path. Repository scripts were
  evaluated separately as dogfooding evidence.
- The tested registry state was:
  - latest `@specxai/moura`: `0.1.1`;
  - published versions: `0.1.0`, `0.1.1`;
  - version declared on `main`: `0.1.2`.
- Clean-consumer checks used Node.js 24.21.0. The repository requires Node.js
  24 or newer.

## 2. Executive result

**Blocking: a first-time external user cannot currently complete the public
onboarding flow from a clean environment.**

The documentation and example describe a coherent end-to-end flow, and the
example passes when it is tested with an artifact packed from current `main`.
The public path is nevertheless blocked at the release boundary:

1. the official example depends on `@specxai/moura@^0.1.2`;
2. npm currently publishes only through `0.1.1`; and
3. published `0.1.1` implements the former canonical-`moura_case` contract,
   not the separate local-ID labels and strict traceability option documented
   on `main`.

Consequently, green `main` CI proves the prospective `0.1.2` artifact but does
not prove that the package presently obtainable from npm satisfies the public
documentation.

## 3. End-to-end execution result

| External-user step            | Result                                                     | Observation                                                                     |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Discover Moura                | Pass                                                       | The root README describes its purpose and directs users to the minimal example. |
| Understand prerequisites      | Pass                                                       | Both entry points state Node.js 24 or newer.                                    |
| Install                       | **Blocked**                                                | The example requests unpublished `@specxai/moura@^0.1.2`.                       |
| Create `moura.yaml`           | Pass in documentation                                      | The example contains a complete minimal manifest.                               |
| Create Requirement Markdown   | Pass in documentation                                      | The example contains a complete Requirement.                                    |
| Create Specification Markdown | Pass in documentation                                      | The example contains the Requirement → Scenario → Case hierarchy.               |
| Run `moura validate`          | Pass with packed `main`; pass with npm `0.1.1`             | Project structure is valid.                                                     |
| Configure Vitest + Allure     | Pass with packed `main`                                    | The reporter and `allure-results` output directory are explicit.                |
| Add Moura metadata            | Pass with packed `main`; **incompatible with npm `0.1.1`** | The example uses the current five-label contract.                               |
| Run Vitest                    | Pass with packed `main`                                    | The example test passes.                                                        |
| Generate `allure-results`     | Pass with packed `main`                                    | One non-empty result JSON is generated and verified.                            |
| Run strict check              | Pass with packed `main`; **unsupported by npm `0.1.1`**    | `0.1.1` rejects `--strict-traceability`.                                        |
| Generate report               | Pass with packed `main`                                    | The generated report is non-empty and contains the canonical Case identity.     |
| Understand traceability       | Pass                                                       | Mapping, scope, and presentation labels are distinguished.                      |

### Published-package reproduction

A clean Node.js 24 project installed `@specxai/moura@0.1.1`, copied the official
example manifest and Markdown, and supplied a passing Allure result using the
metadata currently documented on `main`.

- `moura --version` printed `moura 0.1.1`.
- `moura validate .` exited successfully.
- `moura check . --strict-traceability` exited with usage text because the
  option is not implemented in `0.1.1`.
- `moura check .` reported the required pair as `MISSING`, rejected
  `moura_case=CASE-001` as an invalid canonical Case ID, and reported a missing
  valid `moura_case`.
- `moura report .` wrote HTML but exited unsuccessfully with the same Evidence
  mapping errors.

This is an executable contract mismatch, not only a package-version mismatch.

## 4. Previous blocking gaps status

| Previous gap                                                            | Status              | Evidence-based assessment                                                                                                             |
| ----------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Published npm package and `main` documentation metadata contract differ | **Not fixed**       | The source/package smoke was improved, but the compatible `0.1.2` artifact is not published and `0.1.1` rejects the current contract. |
| No external-user Allure-results generation procedure                    | **Fixed**           | The example documents the reporter, output directory, test command, and result verification.                                          |
| No completely runnable minimal example                                  | **Partially fixed** | The example is complete and succeeds with a packed `main` artifact, but its public npm dependency cannot currently be installed.      |

## 5. npm package contract

The current documentation defines these labels as the authoritative mapping:

- `moura_requirement`;
- `moura_scenario`;
- `moura_case`; and
- `moura_layer`.

The first three values are aligned local-ID tuples from which Moura reconstructs
canonical Case IDs. `moura_traceability=managed` independently declares that a
result is in reverse-traceability scope.

The published `0.1.1` artifact instead accepts a canonical Case ID in one
`moura_case` label. It does not implement the documented tuple contract,
managed-result `UNMAPPED` diagnostic, or `--strict-traceability` option.

**Classification: D. Package/release contract gap — Blocking.**

## 6. Official Vitest onboarding result

The example makes every required file visible and gives a copy/paste command
sequence for install, validation, test execution, result verification, strict
checking, and report generation. It uses the public `allure-vitest` reporter and
direct `allure-js-commons` API rather than Moura's internal dogfooding helpers.

`pnpm test:onboarding` passed against a package packed from current `main`. That
smoke verified:

- a passing Vitest execution;
- exactly one current result JSON;
- `moura_traceability=managed`;
- all four authoritative mapping labels;
- the `epic` / `feature` / `story` presentation hierarchy;
- successful strict checking; and
- a non-empty Requirement Coverage report containing
  `REQ-001/SCN-001/CASE-001`.

The literal public `npm install` path did not complete because the example's
required Moura version is not in the registry. The example is therefore
technically complete but not publicly runnable at the audit baseline.

## 7. Cross-platform result

The public example does not require POSIX-only cleanup or result-checking
commands. It removes stale results using the Node.js filesystem API and verifies
JSON files using a Node.js script. The same flow is reasonable on Windows,
macOS, and Linux.

The latest `main` GitHub Actions run completed the dedicated Windows package,
Allure, and onboarding smoke successfully. Linux execution also passed during
this audit. There is no dedicated macOS job, but no OS-specific command was
found in the public example path.

**Cross-platform implementation: Pass. Public availability remains blocked on
all platforms by the npm release gap.**

## 8. Stale Evidence result

The example's `pretest` removes `allure-results` before every test run. The
repository onboarding smoke additionally:

1. seeds stale passing Evidence;
2. runs the cleanup and verifies that the results directory is gone;
3. verifies that a check without current Evidence reports `MISSING`;
4. seeds stale Evidence again;
5. runs the normal test command; and
6. verifies that exactly one current result remains and strict checking passes.

The prior-PASS masking path requested by the audit was therefore exercised and
rejected. **Result: Fixed.**

## 9. Moura dogfooding result

The repository declares package consumption as `REQ-006` and official
onboarding as `REQ-007`, with Cases for the metadata contract, release identity,
public Vitest integration, stale-result behavior, strict checking, and report
generation.

The following repository sequence passed:

1. `pnpm test:allure` — 14 files and 200 tests passed; metadata for all 200
   generated results was verified;
2. `pnpm build`;
3. `pnpm test:package`;
4. `pnpm test:onboarding`; and
5. `node dist/cli.js check . --strict-traceability`.

The final strict check had no `MISSING`, unexpected `UNMAPPED`, or broken
Evidence mapping. All `REQ-006` and `REQ-007` pairs passed.

This evidence validates the artifact built from `main`; it does not eliminate
the observed difference between that artifact and registry `0.1.1`.

## 10. Remaining gaps

### Blocking — publish the documented contract

- **Classification:** D. Package/release contract gap.
- **Condition:** `main` and the example require `0.1.2`, while npm exposes only
  the incompatible `0.1.1` artifact.
- **User impact:** installation either cannot resolve the example dependency or
  installs a version that rejects the documented metadata and strict command.
- **Closure evidence:** install the released version from the registry in a
  clean Node.js 24 project and execute the official README sequence unchanged.

### Important — registry-state verification

- **Classification:** E. CI/dogfooding gap.
- **Condition:** package smoke installs a locally packed prospective artifact,
  not the package currently served by npm.
- **Impact:** `main` CI can remain green while the documented external contract
  is unavailable from the registry.
- **Boundary:** pre-merge local-artifact testing remains valuable and should not
  be replaced. A post-publish or release verification should complement it.

No remaining blocking documentation, example-content, product UX, stale
Evidence, or cross-platform implementation gap was found.

## 11. Suggested issues

Only release-focused follow-up is warranted:

1. **Publish `@specxai/moura@0.1.2` and verify the registry artifact against the
   official onboarding flow.** If Issue #69 already covers completion of the
   release boundary, keep that issue open rather than creating a duplicate.
2. **Add a post-publish registry smoke for the documented contract.** It should
   verify registry version availability, CLI version, the five labels, strict
   checking, and non-empty report generation from a clean consumer project.

## 12. Final external-user readiness assessment

**No: at this audit baseline, a first-time external user cannot reach the first
Requirement Coverage report from a clean environment using only public
information and the package currently available from npm.**

The documentation, example design, current implementation, stale-Evidence
protection, cross-platform path, and repository dogfooding are ready. Published
external-user readiness remains blocked until the compatible artifact is
released and the unchanged public onboarding flow passes against that registry
artifact.
