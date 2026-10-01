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

  it("sends the structured-information contract to the translation API", async () => {
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
    expect(instructions).toContain("heading IDs, hierarchy, and order exactly");
    expect(instructions).toContain(
      "Translate human-readable Markdown link labels",
    );
    expect(instructions).toContain(
      "does not infer Moura references from arbitrary natural-language prose",
    );
    expect(instructions).toContain("destinations and optional titles");
    expect(instructions).toContain(
      "reference-identifier case/whitespace normalization",
    );
    expect(instructions).not.toContain("insert whitespace");
    expect(instructions).not.toContain("manifest local or canonical ID");
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
