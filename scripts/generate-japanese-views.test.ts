import { afterEach, describe, expect, it as vitestIt, vi } from "vitest";

import { mouraEvidenceTest } from "../src/test-support/moura-evidence.js";
import { translateMarkdown } from "./generate-japanese-views.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-008/SCN-001/CASE-001"], "unit");

function mockResponse(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Japanese view generation", () => {
  it("rejects partial output from an incomplete response", async () => {
    mockResponse({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [
        {
          content: [{ type: "output_text", text: "# 途中までの翻訳" }],
        },
      ],
    });

    await expect(
      translateMarkdown(
        "# Complete source",
        "spec.md",
        "test-key",
        "test-model",
      ),
    ).rejects.toThrow(
      "OpenAI generation was incomplete for spec.md (max_output_tokens)",
    );
  });

  it("sends the identifier delimiter contract to the translation API", async () => {
    mockResponse({
      status: "completed",
      output: [
        { content: [{ type: "output_text", text: "REQ-001 は必須です。" }] },
      ],
    });
    await translateMarkdown(
      "REQ-001 is required.",
      "req.md",
      "test-key",
      "test-model",
    );

    const request = vi.mocked(fetch).mock.calls[0]![1]!;
    const body = JSON.parse(request.body as string) as {
      input: { role: string; content: string }[];
    };
    const instructions = body.input.find(
      (item) => item.role === "system",
    )!.content;
    expect(instructions).toContain(
      "Preserve every identifier string exactly and preserve identifier occurrence order",
    );
    expect(instructions).toContain(
      "Never concatenate translated prose directly onto an identifier",
    );
    expect(instructions).toContain("insert whitespace between them");
    expect(instructions).toContain(
      "Never embed an identifier as a substring of another identifier or add a prefix or suffix",
    );
    expect(instructions).toContain('"REQ-001 は必須です。"');
    expect(instructions).toContain(
      'never "REQ-001は必須です。" or "REQ-001-ja は必須です。"',
    );
  });

  it("returns output text from a completed response", async () => {
    mockResponse({
      status: "completed",
      output: [
        {
          content: [{ type: "output_text", text: "# 完全な翻訳\n" }],
        },
      ],
    });

    await expect(
      translateMarkdown(
        "# Complete source",
        "spec.md",
        "test-key",
        "test-model",
      ),
    ).resolves.toMatch(/# 完全な翻訳\n$/u);
  });
});
