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
