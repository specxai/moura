# Japanese generated views

`req.md` and `spec.md` in this directory are generated, read-only Japanese
views of the canonical English [`req.md`](../../req.md) and
[`spec.md`](../../spec.md). Do not edit the generated files manually. The
English documents remain authoritative if a view differs from its source.

Maintainers generate the views with the manually triggered **Generate Japanese
views** GitHub Actions workflow. The workflow uses the repository's
`OPENAI_API_KEY` secret, translates both documents, deterministically validates
traceability and protected Markdown content, and publishes `docs/ja/req.md` and
`docs/ja/spec.md` together as a workflow artifact. It does not commit them, and
normal CI does not require an API key.

The OpenAI integration is deliberately repository-local automation for this
proof of concept. It is not a Moura CLI feature or a public translation-provider
contract.

Preserved manifest / traceability identifiers must be clearly delimited from
translated prose. Keep every identifier string and its occurrence order unchanged;
do not embed it as a substring of another identifier or add a prefix or suffix.
When translated prose follows an identifier, separate it with whitespace:
`REQ-001 is required.` becomes `REQ-001 は必須です。`, never
`REQ-001は必須です。` or `REQ-001-ja は必須です。`. Validation checks
identifier boundaries deterministically, without language-specific exceptions or
semantic translation validation.
