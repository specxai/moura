import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const allureStatuses = ["passed", "failed", "broken", "skipped"] as const;
type AllureStatus = (typeof allureStatuses)[number];

interface AllureStatusResult {
  readonly status: AllureStatus;
}

export interface AllureCounts extends Record<AllureStatus, number> {
  readonly tests: number;
}

function isAllureStatus(status: unknown): status is AllureStatus {
  return (
    typeof status === "string" &&
    (allureStatuses as readonly string[]).includes(status)
  );
}

function parseAllureStatusResult(
  text: string,
  path: string,
): AllureStatusResult {
  const value: unknown = JSON.parse(text);
  const status =
    typeof value === "object" && value !== null && "status" in value
      ? value.status
      : undefined;
  if (!isAllureStatus(status)) {
    throw new Error(
      `Allure test result ${path} has unsupported status ${JSON.stringify(status)}`,
    );
  }
  return { status };
}

export async function readAllureCounts(
  directory: string,
): Promise<AllureCounts> {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith("-result.json"))
    .sort();
  const counts: AllureCounts = {
    tests: files.length,
    passed: 0,
    failed: 0,
    broken: 0,
    skipped: 0,
  };

  for (const file of files) {
    const path = join(directory, file);
    let result: AllureStatusResult;
    try {
      result = parseAllureStatusResult(await readFile(path, "utf8"), path);
    } catch (cause) {
      if (
        cause instanceof Error &&
        cause.message.startsWith("Allure test result")
      )
        throw cause;
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(`Cannot read Allure test result ${path}: ${detail}`, {
        cause,
      });
    }
    counts[result.status] += 1;
  }

  return counts;
}
