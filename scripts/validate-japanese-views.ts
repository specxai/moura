import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseManifest } from "../src/manifest.js";
import { isDirectExecution } from "./direct-execution.js";
import { validateJapaneseView } from "../src/japanese-view.js";
export {
  validateJapaneseView,
  type DocumentRole,
} from "../src/japanese-view.js";

async function main(): Promise<void> {
  const root = resolve(process.argv[2] ?? ".");
  const manifestResult = parseManifest(
    await readFile(resolve(root, "moura.yaml"), "utf8"),
  );
  if (!manifestResult.value || manifestResult.errors.length > 0)
    throw new Error(
      `Cannot validate generated views with an invalid manifest:\n${manifestResult.errors.map((item) => item.message).join("\n")}`,
    );

  const pairs = [
    ["req.md", "docs/ja/req.md", "requirements"],
    ["spec.md", "docs/ja/spec.md", "specifications"],
  ] as const;
  const problems = (
    await Promise.all(
      pairs.map(async ([canonicalPath, generatedPath, role]) =>
        validateJapaneseView(
          await readFile(resolve(root, canonicalPath), "utf8"),
          await readFile(resolve(root, generatedPath), "utf8"),
          role,
          manifestResult.value!,
        ).map((problem) => `${generatedPath}: ${problem}`),
      ),
    )
  ).flat();
  if (problems.length > 0)
    throw new Error(
      `Japanese view integrity validation failed:\n${problems.join("\n")}`,
    );
  console.log(
    "Japanese generated views preserve Moura traceability invariants.",
  );
}

if (isDirectExecution(import.meta.url))
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : cause);
    process.exitCode = 1;
  });
