import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

const marker = ".moura-report.json";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
}

async function stat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Reject symlinks in every existing path component, including dangling links. */
async function checkParents(path: string): Promise<void> {
  let current = parse(path).root;
  for (const part of relative(current, path).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const info = await stat(current);
    if (info && (info.isSymbolicLink() || !info.isDirectory()))
      throw new Error(`Unsafe output path component: ${current}`);
  }
}

async function inventory(path: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const name of await readdir(path)) {
    const child = resolve(path, name);
    const entry = await lstat(child);
    if (
      entry.isSymbolicLink() ||
      (!entry.isDirectory() && (!entry.isFile() || entry.nlink !== 1))
    )
      throw new Error(`Unsafe output entry: ${child}`);
    if (entry.isDirectory()) {
      if (!["moura", "moura/sources"].includes(`${prefix}${name}`))
        throw new Error(`Unrecognized output directory: ${child}`);
      files.push(...(await inventory(child, `${prefix}${name}/`)));
    } else files.push(`${prefix}${name}`);
  }
  return files.sort();
}

async function inspectOutput(output: string, root: string): Promise<boolean> {
  if (!(await stat(output))) return false;
  const files = await inventory(output);
  if (files.length === 0) return true;
  if (!files.includes(marker))
    throw new Error(
      "Output is not an owned Moura v2 report. Choose a new --output directory or move the old report aside; no existing files were removed.",
    );
  const value: unknown = JSON.parse(
    await readFile(resolve(output, marker), "utf8"),
  );
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 2 ||
    !("project" in value) ||
    value.project !== root ||
    !("files" in value) ||
    typeof value.files !== "object" ||
    value.files === null
  )
    throw new Error("Invalid Moura report ownership marker");
  const hashes = value.files as Record<string, unknown>;
  if (
    JSON.stringify(files.filter((file) => file !== marker)) !==
    JSON.stringify(Object.keys(hashes).sort())
  )
    throw new Error(
      "Output contains unrecognized files; refusing to replace it",
    );
  for (const file of files.filter((file) => file !== marker)) {
    if (
      !(
        file === "index.html" ||
        file === "moura/index.html" ||
        /^moura\/sources\/source-[a-f0-9]{64}\.html$/u.test(file)
      ) ||
      hashes[file] !== digest(await readFile(resolve(output, file), "utf8"))
    )
      throw new Error(
        `Output file was modified: ${file}; refusing to replace it`,
      );
  }
  return true;
}

/** Never recursively delete a user-selected directory. Stage, validate, then rename. */
export async function writeReportOutput(
  root: string,
  requested: string,
  protectedInputs: readonly string[],
  files: ReadonlyMap<string, string>,
): Promise<string> {
  if (!requested.trim()) throw new Error("Output directory must not be empty");
  const output = resolve(root, requested);
  if (output === parse(output).root || contains(output, root))
    throw new Error(
      "Output must not be the filesystem root, project root, or an ancestor of the project",
    );
  const protectedPaths = [
    "src",
    "lib",
    "test",
    "tests",
    "docs",
    "node_modules",
    ".git",
    "allure-results",
    "coverage",
    "allure-report",
    ...protectedInputs,
  ];
  for (const input of protectedPaths.map((path) => resolve(root, path))) {
    const paths = [input];
    if (await stat(input)) paths.push(await realpath(input));
    for (const path of paths)
      if (contains(output, path) || contains(path, output))
        throw new Error(`Output overlaps protected input: ${path}`);
  }
  await checkParents(output);
  const existed = await inspectOutput(output, root);
  const original = await stat(output);
  await mkdir(dirname(output), { recursive: true });
  await checkParents(dirname(output));
  const stage = await mkdtemp(resolve(dirname(output), ".moura-stage-"));
  let backup: string | undefined;
  let published = false;
  try {
    for (const [file, contents] of files) {
      await mkdir(dirname(resolve(stage, file)), { recursive: true });
      await writeFile(resolve(stage, file), contents, { flag: "wx" });
    }
    await writeFile(
      resolve(stage, marker),
      JSON.stringify({
        version: 2,
        project: root,
        files: Object.fromEntries(
          [...files].map(([file, contents]) => [file, digest(contents)]),
        ),
      }) + "\n",
      { flag: "wx" },
    );
    await checkParents(output);
    if ((await inspectOutput(output, root)) !== existed)
      throw new Error("Output changed while generating report");
    const current = await stat(output);
    if (original?.ino !== current?.ino || original?.dev !== current?.dev)
      throw new Error("Output identity changed while generating report");
    if (existed) {
      backup = await mkdtemp(resolve(dirname(output), ".moura-backup-"));
      await rmdir(backup);
      await rename(output, backup);
    }
    try {
      await rename(stage, output);
      published = true;
    } catch (error) {
      if (backup) await rename(backup, output);
      backup = undefined;
      throw error;
    }
    if (backup) {
      await inspectOutput(backup, root);
      await removeGeneratedDirectory(backup);
    }
    return output;
  } finally {
    if (!published) await removeGeneratedDirectory(stage);
  }
}

/** Unlink known regular files only; never follow links or recurse through unknown paths. */
async function removeGeneratedDirectory(path: string): Promise<void> {
  const files = await inventory(path);
  for (const file of files) await unlink(resolve(path, file));
  for (const directory of ["moura/sources", "moura", ""]) {
    if (await stat(resolve(path, directory)))
      await rmdir(resolve(path, directory));
  }
}
