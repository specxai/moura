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
