import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Compare an ES module URL with a CLI entry path without URL-significant path ambiguity. */
export function isDirectExecution(
  moduleUrl: string,
  entry = process.argv[1],
): boolean {
  return (
    entry !== undefined && moduleUrl === pathToFileURL(resolve(entry)).href
  );
}
