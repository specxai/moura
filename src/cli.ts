#!/usr/bin/env node

import { validateProjectDirectory } from "./project.js";
import { checkProjectDirectory } from "./check-command.js";
import { reportProjectDirectory } from "./report.js";

const [command, ...commandArguments] = process.argv.slice(2);

if (command === "--version" || command === "-v") {
  console.log("moura 0.1.2");
} else if (command === "validate") {
  if (commandArguments.length > 1) {
    console.error("Usage: moura validate [directory]");
    process.exitCode = 1;
  } else {
    const directory = commandArguments[0] ?? process.cwd();
    const result = await validateProjectDirectory(directory);
    if (result.errors.length === 0) {
      console.log("✓ Traceability is valid");
    } else {
      console.error("✗ Traceability validation failed");
      for (const problem of result.errors)
        console.error(`- ${problem.message}`);
      process.exitCode = 1;
    }
  }
} else if (command === "check") {
  const strict = commandArguments.includes("--strict-traceability");
  const directories = commandArguments.filter(
    (argument) => argument !== "--strict-traceability",
  );
  if (
    directories.length > 1 ||
    commandArguments.some(
      (argument) =>
        argument.startsWith("--") && argument !== "--strict-traceability",
    )
  ) {
    console.error("Usage: moura check [directory] [--strict-traceability]");
    process.exitCode = 1;
  } else {
    const result = await checkProjectDirectory(
      directories[0] ?? process.cwd(),
      { strictTraceability: strict },
    );
    for (const line of result.stdout) console.log(line);
    for (const line of result.stderr) console.error(line);
    process.exitCode = result.exitCode;
  }
} else if (command === "report") {
  const directories: string[] = [];
  let output: string | undefined;
  let japaneseViews: string | undefined;
  let invalid = false;
  for (let index = 0; index < commandArguments.length; index++) {
    const argument = commandArguments[index]!;
    if (argument === "--output" || argument === "--japanese-views") {
      const value = commandArguments[++index];
      if (!value || value.startsWith("--")) {
        invalid = true;
        break;
      }
      if (argument === "--output") {
        if (output !== undefined) invalid = true;
        output = value;
      } else {
        if (japaneseViews !== undefined) invalid = true;
        japaneseViews = value;
      }
    } else if (argument.startsWith("-")) invalid = true;
    else directories.push(argument);
  }
  if (invalid || directories.length > 1) {
    console.error(
      "Usage: moura report [directory] [--output <directory>] [--japanese-views <json>]\nReport output must not exist, even as an empty directory. Remove it yourself before regenerating.",
    );
    process.exitCode = 1;
  } else {
    const result = await reportProjectDirectory(
      directories[0] ?? process.cwd(),
      {
        ...(output === undefined ? {} : { output }),
        ...(japaneseViews === undefined ? {} : { japaneseViews }),
      },
    );
    if (result.overviewPath)
      console.log(`✓ Quality Overview: ${result.overviewPath}`);
    if (result.outputPath)
      console.log(`✓ Requirement coverage report: ${result.outputPath}`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = result.exitCode;
  }
} else {
  console.log(
    [
      "Moura is in early development.",
      "Available commands: validate, check, report.",
      "Usage: moura report [directory] [--output <directory>] [--japanese-views <json>]",
      "Report output must not exist, even as an empty directory. Remove it yourself before regenerating.",
    ].join("\n"),
  );
  if (command && command !== "--help" && command !== "-h") {
    process.exitCode = 1;
  }
}
