import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, sep } from "node:path";

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

async function requireAbsent(output: string): Promise<void> {
  if (await stat(output))
    throw new Error(
      `Output already exists: ${output}. Remove it yourself before regenerating the report.`,
    );
}

/** Create only new output. Exclusive creation never replaces an existing destination. */
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
      `Unsafe output ${output}: must not be the filesystem root, project root, or an ancestor of the project`,
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
        throw new Error(
          `Unsafe output ${output}: overlaps protected input ${path}`,
        );
  }
  await requireAbsent(output);
  await checkParents(output);
  for (const file of files.keys()) {
    if (
      file !== "index.html" &&
      file !== "moura/index.html" &&
      !/^moura\/sources\/source-[a-f0-9]{64}\.html$/u.test(file)
    )
      throw new Error(`Invalid report file: ${file}`);
  }
  await mkdir(dirname(output), { recursive: true });
  await checkParents(dirname(output));
  const stage = await mkdtemp(resolve(dirname(output), ".moura-stage-"));
  const created: {
    path: string;
    ino: number;
    dev: number;
    directory: boolean;
  }[] = [];
  const remember = async (path: string, directory: boolean) => {
    const info = await lstat(path);
    created.push({ path, ino: info.ino, dev: info.dev, directory });
  };
  try {
    for (const [file, contents] of files) {
      await mkdir(dirname(resolve(stage, file)), {
        recursive: true,
        mode: 0o700,
      });
      await writeFile(resolve(stage, file), contents, {
        flag: "wx",
        mode: 0o600,
      });
    }
    await checkParents(output);
    await requireAbsent(output);
    try {
      await mkdir(output, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        await requireAbsent(output);
      throw error;
    }
    await remember(output, true);
    for (const directory of ["moura", "moura/sources"]) {
      if (![...files.keys()].some((file) => file.startsWith(`${directory}/`)))
        continue;
      const path = resolve(output, directory);
      await mkdir(path, { mode: 0o700 });
      await remember(path, true);
    }
    for (const file of files.keys()) {
      const path = resolve(output, file);
      await copyFile(resolve(stage, file), path, constants.COPYFILE_EXCL);
      await remember(path, false);
    }
    if (process.platform !== "win32") {
      for (const entry of [...created].reverse())
        await chmod(
          entry.path,
          (entry.directory ? 0o777 : 0o666) & ~process.umask(),
        );
    }
    return output;
  } catch (error) {
    // Only remove objects created by this invocation, never competing user data.
    if (process.platform !== "win32") {
      for (const entry of created.filter((entry) => entry.directory)) {
        await checkParents(dirname(entry.path));
        const info = await stat(entry.path);
        if (
          info?.isDirectory() &&
          info.ino === entry.ino &&
          info.dev === entry.dev
        )
          await chmod(entry.path, info.mode | 0o700);
      }
    }
    for (const entry of [...created].reverse()) {
      await checkParents(dirname(entry.path));
      const info = await stat(entry.path);
      if (
        !info ||
        info.isSymbolicLink() ||
        info.ino !== entry.ino ||
        info.dev !== entry.dev
      )
        continue;
      if (entry.directory) {
        try {
          await rmdir(entry.path);
        } catch (cleanupError) {
          if (
            !["ENOTEMPTY", "EEXIST"].includes(
              (cleanupError as NodeJS.ErrnoException).code ?? "",
            )
          )
            throw cleanupError;
        }
      } else await unlink(entry.path);
    }
    throw error;
  } finally {
    // This private temporary directory is never a user-selected output.
    await rm(stage, { recursive: true, force: true });
  }
}
