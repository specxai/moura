/** The query carries display language through portable report URLs and history. */
const japanese: Readonly<Record<string, string>> = {
  "Moura Requirement Coverage": "Moura 要求カバレッジ",
  "Moura Quality Reports": "Moura 品質レポート",
  "Verification completeness against project requirements.":
    "プロジェクトの要求に対する検証の完了状況です。",
  "Overall Status": "総合ステータス",
  "Required verification and its Evidence determine this status.":
    "必要な検証とそのエビデンスに基づくステータスです。",
  "Requirement Coverage": "要求カバレッジ",
  "Missing Evidence": "不足エビデンス",
  "View verification gaps →": "検証の不足を確認 →",
  "Test Results": "テスト結果",
  Passed: "成功",
  Failed: "失敗",
  Skipped: "スキップ",
  "Code Coverage": "コードカバレッジ",
  Lines: "行",
  "Detailed Reports": "詳細レポート",
  "Declared traceability and verification status":
    "宣言されたトレーサビリティと検証状況",
  "Allure Report": "Allure レポート",
  "Test execution details": "テスト実行の詳細",
  "Source code coverage": "ソースコードのカバレッジ",
  Unavailable: "利用不可",
  "Open →": "開く →",
  PASS: "合格",
  INCOMPLETE: "未完了",
  FAIL: "失敗",
  "Source:": "ソース:",
  "Commit:": "コミット:",
  "Coverage of declared traceability and evidence. Moura does not prove that a test semantically verifies the specification it declares.":
    "宣言されたトレーサビリティとエビデンスのカバレッジ。Moura は、テストが宣言した仕様を意味的に検証していることを証明しません。",
  Requirements: "要求",
  Scenarios: "シナリオ",
  Cases: "ケース",
  "Required Case × layer pairs": "必須のケース × レイヤーの組み合わせ",
  "Pair statuses": "組み合わせのステータス",
  "Per-layer coverage": "レイヤー別カバレッジ",
  Layer: "レイヤー",
  "PASS / required": "PASS / 必須",
  "Requirement hierarchy and exact verification gaps": "要求の階層と検証の不足",
  "Reverse Traceability": "逆方向トレーサビリティ",
  "Evidence Issues": "エビデンスの問題",
  "✓ No issues found": "✓ 問題なし",
  "Unable to complete diagnostics; see Evidence Issues.":
    "診断できません。エビデンスの問題を確認してください。",
  "← Requirement Coverage": "← 要求カバレッジ",
  Specification: "仕様",
  "English canonical source; Japanese is a translation.":
    "英語が正本です。日本語は翻訳です。",
  "Japanese translation unavailable; showing English.":
    "日本語訳がないため英語の原文を表示しています。",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Inline to keep standalone reports usable without a server or external assets. */
export const reportLocaleScript = `(() => {
  const url = new URL(location.href);
  const locale = url.searchParams.get('lang') === 'ja' ? 'ja' : 'en';
  const source = document.querySelector('[data-source-content]');
  const translation = document.querySelector('template[data-translation]');
  document.documentElement.lang = source && !translation ? 'en' : locale;
  document.querySelectorAll('[data-ja]').forEach(element => {
    if (locale === 'ja') element.textContent = element.dataset.ja;
  });
  if (source && translation && locale === 'ja') source.innerHTML = translation.innerHTML;
  const fallback = document.querySelector('[data-fallback]');
  if (fallback) fallback.hidden = locale !== 'ja' || !!translation;
  document.querySelectorAll('a[href]').forEach(link => {
    const href = link.getAttribute('href');
    if (!href || !href.startsWith('.')) return;
    const target = new URL(href, location.href);
    target.searchParams.set('lang', locale);
    link.setAttribute('href', href.split(/[?#]/)[0] + target.search + target.hash);
  });
  document.querySelectorAll('[data-language]').forEach(link => {
    const target = new URL(location.href);
    target.searchParams.set('lang', link.dataset.language);
    link.href = target.href;
    link.setAttribute('aria-current', link.dataset.language === locale ? 'true' : 'false');
  });
  if (location.hash && source && translation && locale === 'ja') {
    const anchor = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (anchor) anchor.scrollIntoView();
  }
})();`;

export function withReportLocale(html: string): string {
  const localized = html.replace(
    /<(h[1-4]|p|strong|span|th|a|title)([^>]*)>([^<]+)<\/(h[1-4]|p|strong|span|th|a|title)>/gu,
    (
      match: string,
      tag: string,
      attributes: string,
      text: string,
      closing: string,
    ) => {
      const translation = japanese[text];
      return translation
        ? `<${tag}${attributes} data-ja="${escapeHtml(translation)}">${text}</${closing}>`
        : match;
    },
  );
  return localized
    .replace(
      "<main>",
      '<main><nav aria-label="Language"><a href="?lang=ja" data-language="ja" lang="ja">日本語</a> | <a href="?lang=en" data-language="en" lang="en">English</a></nav>',
    )
    .replace("</body>", `<script>${reportLocaleScript}</script></body>`);
}
