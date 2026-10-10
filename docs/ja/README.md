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

Generated Japanese views preserve parsed Moura heading IDs, hierarchy, and
order, and explicitly structured machine-relevant Markdown: code, HTML,
link/image destinations and optional titles, and reference
identifiers/definitions, including their containing Markdown blocks.
Human-readable link labels may be translated even when their text matches a
manifest ID. Reference identifiers are compared using Markdown's
case/whitespace normalization rather than their original source spelling. The
validator does not infer Moura reference semantics from link labels or
arbitrary natural-language prose, or validate translation meaning. It checks
prose block preservation, including content presence in headings and paragraphs.
Traceability heading IDs and protected code/HTML/autolinks do not substitute for
translatable prose content. It checks structural presence, not semantic equivalence. No prose identifier
delimiter is required. This PoC does not define Moura reference syntax,
anchors, or link-target resolution.

## Reading views from Quality Reports

The repository [Quality Reports site](https://specxai.github.io/moura/) includes
Japanese Requirements and Specifications when CI can consume an eligible
artifact. Pages show escaped, wrapped Markdown, the bilingual generated/read-only
and English-authoritative notice, links to the canonical English files at the
actual source commit, and the producer run/artifact identity. These pages are
presentation only: Moura's configured English sources, parsing, identities,
evidence, coverage, and canonical Requirement-source snapshots are unchanged.

The consumer searches at most the 300 most recent main workflow-dispatch runs of
this repository's exact Japanese workflow. It chooses the newest eligible
success artifact by artifact creation time (including reruns of older runs),
not the newest generation attempt. Repository, workflow, branch, event, successful
run status, artifact name, expiration, matching run provenance, and archive
SHA-256 digest must all pass. Failed-validation debugging artifacts are never
consumed. Latest-attempt status uses `run_started_at` and `run_attempt`, not the
original run's creation time; artifact selection remains independently ordered
by artifact creation. A later failed attempt remains visible in the producer workflow and CI
retrieval summary; an older eligible success is labelled with its actual provenance.

Freshness requires exact byte equality between the producer commit's `req.md`,
`spec.md`, and `moura.yaml` (read through GitHub at the immutable producer SHA)
and the current checkout. Structural validity alone does not establish freshness.
The consumer requires both generated files and their exact bilingual notice,
and reruns the existing deterministic validator against current canonical inputs.
Only these two literal ZIP members are read; no archive paths are extracted or
executed. Retrieval is bounded to 90 seconds, responses/archives to 5 MiB, and
each document to 1 MiB. The Ubuntu CI reader uses its existing `unzip` utility;
no rendering or translation dependency is added.

Eligible data is staged in ignored `node_modules/.cache/moura-japanese-views/`,
with producer identity and SHA-256 digests of all three canonical inputs.
Assembly rechecks these digests and reruns validation before embedding Japanese
content in the canonical REQ and Spec pages under `_site/moura/sources/`.
Raw `docs/ja/` files alone never
qualify for publication. Both stage retrieval and site assembly clear their
previous generated output, so missing or rejected views cannot leave stale pages.

### Refresh and failure behavior

1. Manually run **Generate Japanese views** on `main` (model override remains
   available) and require successful generation and validation.
2. Successful completion automatically starts **CI** through GitHub's
   `workflow_run` completion event, after the success artifact upload finishes.
   No second manual invocation is needed. Both the Linux quality and Windows
   smoke gates must still succeed before the existing Pages deployment.
   Dispatches on other branches and PRs do not publish Pages.
3. Open Requirement Coverage from Quality Reports, select **日本語**, and follow
   REQ and Spec links. The selected language carries through navigation; sources
   without a translation fall back to English.

PR CI retains the assembled site as a `quality-site` workflow artifact for
review without replacing public Pages. Tests exercise both eligible and
unavailable Japanese states; a PR whose canonical inputs changed correctly
falls back to English until a matching trusted main artifact exists.

Generation alone does not deploy Pages. A main code-only change can reuse an
older artifact if all three canonical input files remain byte-equivalent.
Changing canonical prose, including this feature's specification update, requires
a newly generated matching artifact. Success and failed-validation artifacts
retain the existing 14-day expiration policy; the published static pages persist
until the next deployment, but an expired artifact cannot be consumed again.

The completion listener must exist on `main` before automatic refresh works.
CI accepts only a successful completed manual run of this repository's exact
Japanese workflow on `main`, including reruns, and checks out the trusted default
branch commit recorded by GitHub for the refresh event (`github.sha`), not the
producer's commit or artifact code. The event's ref must be `refs/heads/main`.
Producer permissions remain `contents: read`; no dispatch API, PAT, App credential,
or `actions: write` is used. CI listens only for the Japanese workflow, which
remains manual, so the handoff cannot recursively trigger itself.

Generation, validation, or success-upload failure prevents the refresh jobs from
running. A failed-validation debugging upload never qualifies. Failed producer
completions use an isolated concurrency group, so their skipped CI runs cannot
cancel an active or queued main report build. GitHub emits the
completion event directly; there is no separate fallible API request step in the
producer. A successful producer run means a validated artifact exists, not that
Pages publication succeeded: inspect the automatically started CI run and its
Pages deployment for publication status. CI failures remain visible there.
If the uploaded artifact is not yet visible to the bounded consumer, the normal
unavailable state and CI reason apply; no unbounded retry or weaker checks are used.
Ordinary main pushes and manual CI dispatch remain supported as refresh paths.

Missing, expired, stale, incomplete, untrusted, unavailable, or validation-rejected
artifacts produce a concise unavailable state without document links. Retrieval
and assembly report the reason in CI logs/summary. Canonical reports still build
and publish under their existing gates; their own failures still fail CI.
Normal CI needs only read-only GitHub artifact/source access and never calls
OpenAI or receives `OPENAI_API_KEY`. The producer failure and debug-artifact
behavior are unchanged.

## 外部プロジェクト向け Report CLI v2

Node.js 24 以降で、インストール済みの npm パッケージだけから実行できます。

```sh
moura report .
moura report ./my-project --output reports/quality
moura report ./my-project --output /tmp/my-project-quality
```

相対的な出力先はプロジェクトディレクトリが基準です。トップの
`moura-report/index.html` は Quality Overview になり、要求マップは
`moura-report/moura/index.html`、REQ/Spec の閲覧ページは
`moura-report/moura/sources/` に配置されます。

Allure results や coverage summary がなくても生成でき、不足は概要と診断に
表示されます。Allure/coverage の HTML は生成・コピーせず、未配置のレポートへ
リンクしません。`?lang=ja` / `?lang=en` は引き続き利用できます。

日本語タイトルは `--japanese-views <json>` で明示的に指定し、共通の整合性検証を
通過した翻訳のみ使用します。JSON は正本ソースのパスをキー、日本語 Markdown
のパスを値とするオブジェクトです。パスはプロジェクト基準で解決されます。
翻訳のないタイトルは英語に戻ります。API キーや AI 翻訳は不要です。

出力先が存在する場合は、空ディレクトリでもエラーになります。既存の出力は
削除・上書き・更新しません。再生成する場合は、利用者が事前に出力先を削除するか、
別の出力先を選んでください。所有権metadataやバックアップは生成しません。
ルート、入力との重複、シンボリックリンク経由の出力は引き続き拒否します。
詳細は [英語の CLI ガイド](../../README.md#cli) と
[変更履歴](../../CHANGELOG.md) を参照してください。
