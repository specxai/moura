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

Generated Japanese views preserve Moura traceability structure and explicitly
structured machine-relevant Markdown: code, HTML, link/image destinations, and
reference definitions. Link labels that exactly match manifest local or canonical
IDs are also preserved with their destinations and occurrence order; other link
labels may be translated. The validator does not infer Moura references from
arbitrary natural-language prose or validate translation meaning. It checks prose
block preservation, not semantic equivalence. No prose identifier delimiter is
required. This PoC does not define Moura reference syntax, anchors, or link-target
resolution.
