import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

interface ResponseOutput {
  readonly type?: unknown;
  readonly content?: readonly {
    readonly type?: unknown;
    readonly text?: unknown;
  }[];
}

interface OpenAIResponse {
  readonly output?: readonly ResponseOutput[];
  readonly error?: { readonly message?: unknown };
}

const notice = `> **Generated file — do not edit.** This Japanese view is derived from the corresponding English document in the repository root. The English document is authoritative.
>
> **生成ファイル — 編集しないでください。** この日本語版はリポジトリ直下の対応する英語文書から生成されています。英語文書が正本です。

`;

export async function translateMarkdown(
  markdown: string,
  source: string,
  apiKey: string,
  model: string,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content:
            "Translate Markdown prose from English to natural Japanese. Return only the complete translated Markdown, without an outer code fence or commentary. Preserve every Markdown structural relationship. Copy all Requirement, Scenario, and Case IDs, canonical identifiers, inline code, fenced code, commands, file paths, URLs, configuration keys and values, and HTML exactly. Translate only human-readable prose.",
        },
        {
          role: "user",
          content: `Translate ${source}. The English input is authoritative:\n\n${markdown}`,
        },
      ],
    }),
  });
  const body = (await response.json()) as OpenAIResponse;
  if (!response.ok)
    throw new Error(
      `OpenAI Responses API failed (${response.status}): ${String(body.error?.message ?? response.statusText)}`,
    );
  const translated = body.output
    ?.flatMap((item) => item.content ?? [])
    .filter(
      (item) => item.type === "output_text" && typeof item.text === "string",
    )
    .map((item) => item.text as string)
    .join("");
  if (!translated?.trim())
    throw new Error(`OpenAI returned no translation for ${source}`);
  if (/^\s*```(?:markdown)?(?:\r?\n)/u.test(translated))
    throw new Error(
      `OpenAI wrapped ${source} in an outer code fence; generation aborted`,
    );
  return `${notice}${translated.trim()}\n`;
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  if (!model) throw new Error("OPENAI_MODEL is required");

  const root = resolve(process.argv[2] ?? ".");
  await mkdir(resolve(root, "docs/ja"), { recursive: true });
  for (const source of ["req.md", "spec.md"] as const) {
    const translated = await translateMarkdown(
      await readFile(resolve(root, source), "utf8"),
      source,
      apiKey,
      model,
    );
    await writeFile(resolve(root, "docs/ja", source), translated);
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === new URL(`file://${resolve(entry)}`).href)
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
