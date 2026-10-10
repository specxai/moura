# Project-specific CNAD guidance

## Dogfooding validation trace

During CNAD validation, use the pull request as the durable artifact and add a
concise `CNAD Trace` section to its description. Record observed behavior, not
assumed benefits, and include:

- the initial risk;
- the useful context actually selected by the human for the Strategist → Builder
  handoff (not the full conversation);
- how the Builder treated scope and the existing design, plus any escalation;
- that independent review is initiated manually with a fresh `@codex review`,
  without transferring the Builder conversation, and its outcome once known;
- a concrete observed CNAD influence, or `No material influence observed.`

Keep the trace lightweight. Do not create a separate artifact when the pull
request can hold this evidence.

## Role, surface, agent, boundary, and gate mapping

| Handoff                              | Surface                               | Agent / Product                                      | Boundary and evidence                                                                                                                                 | Gate / decision owner                                                                                                          |
| ------------------------------------ | ------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Human → Strategist                   | ChatGPT chat                          | Human → ChatGPT (Strategist)                         | Human supplies intent, goals, constraints, and acceptance criteria; Strategist clarifies scope and risk without taking ownership of intent.           | Human owns intent and approves risk-required decisions before substantial implementation.                                      |
| Strategist → Builder                 | ChatGPT chat → Codex Cloud task       | ChatGPT (Strategist) → Codex (Builder)               | Human selects the implementation-relevant brief (goal, constraints, acceptance criteria, risk, verification). Do not transfer unrelated chat history. | Human controls handoff; Builder owns implementation only within approved scope.                                                |
| Builder → pre-PR Reviewer (optional) | Codex Cloud → separate review context | Codex (Builder) → Codex (Reviewer)                   | Provide diff and minimum verification evidence, never the continuing Builder conversation.                                                            | Independent verdict; Builder fixes blocking in-scope findings and re-verifies. Does not replace PR review.                     |
| Builder → PR Reviewer                | Codex Cloud → GitHub pull request     | Codex (Builder) → Codex (Reviewer, fresh PR context) | Create PR first, then start a new independent review of the completed PR diff; do not inherit Builder or pre-PR Reviewer context or verdict.          | Completed-PR independent review is required for every code change. Blocking findings require fix, verification, and re-review. |
| Reviewer → Human                     | GitHub PR → Human decision            | Codex (Reviewer) → Human                             | Present verdict, findings, risk, and verification evidence, including unresolved items.                                                               | Human alone decides final approval and merge; Reviewer approval is not merge authorization.                                    |

This mapping is declarative and does not automatically launch agents or grant permissions. Follow `.cnad/method/workflow.md`, `.cnad/method/review.md`, and `.cnad/method/risk-routing.md`. Preserve the existing dogfooding CNAD Trace in the PR description. When safe authorized paths are exhausted, escalate to the Human rather than broadening scope or permissions.
