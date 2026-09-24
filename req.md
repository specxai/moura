# Requirements

## REQ-001 Validate traceability structure

Moura shall deterministically validate the structural consistency of a project's
traceability definition before verification evidence is evaluated.

## REQ-002 Check required verification evidence

Moura shall deterministically evaluate whether every verification layer
required by each Case has acceptable evidence.

## REQ-003 Provide safe command-line verification reports

Moura shall expose validation, evidence checking, and Requirement Coverage
reporting through a predictable CLI while generating reports without escaping
or damaging the project boundary.

## REQ-004 Ingest authoritative Allure Evidence

Moura shall reconstruct verification Evidence from authoritative Moura labels
in Allure result files without treating presentation labels or unrelated
results as verification data.

## REQ-005 Dogfood and publish Moura traceability

Moura shall continuously prove that its own complete Vitest suite emits valid
traceability metadata and publish verifiable quality reports from that
Evidence.

## REQ-006 Consume Moura as a published package

Moura shall be usable from its distributable npm package according to the
publicly documented traceability metadata and CLI contracts.

## REQ-007 Provide a runnable onboarding path

Moura shall provide an official Vitest and Allure example that an external user
can execute to validate traceability, produce Evidence, enforce strict reverse
traceability, and generate Requirement Coverage.
