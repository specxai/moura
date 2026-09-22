#!/usr/bin/env node

import { validateProjectDirectory } from "./project.js";
import { checkProjectDirectory } from "./check-command.js";
import { reportProjectDirectory } from "./report.js";

const [command, ...commandArguments] = process.argv.slice(2);

if (command === "--version" || command === "-v") {
  console.log("moura 0.1.1");
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
  if (commandArguments.length > 1) {
    console.error("Usage: moura report [directory]");
    process.exitCode = 1;
  } else {
    const result = await reportProjectDirectory(
      commandArguments[0] ?? process.cwd(),
    );
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
    ].join("\n"),
  );
  if (command && command !== "--help" && command !== "-h") {
    process.exitCode = 1;
  }
}
