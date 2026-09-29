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
