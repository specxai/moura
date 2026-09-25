import { readdir, stat } from "node:fs/promises";
import console from "node:console";
import { join } from "node:path";

const resultsDirectory = "allure-results";
const entries = await readdir(resultsDirectory);
const resultFiles = entries.filter((entry) => entry.endsWith("-result.json"));

if (resultFiles.length === 0) {
  throw new Error(`No Allure result JSON found in ${resultsDirectory}`);
}

for (const resultFile of resultFiles) {
  const result = await stat(join(resultsDirectory, resultFile));
  if (result.size === 0) throw new Error(`${resultFile} is empty`);
}

console.log(
  `Found ${resultFiles.length} non-empty Allure result JSON file(s).`,
);
