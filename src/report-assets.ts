import { constants } from "node:fs";
import { lstat, open, opendir, realpath, mkdir } from "node:fs/promises";
import { dirname, parse, relative, resolve, sep } from "node:path";

/** Resource limits apply across both reports; no provider-specific extension list. */
export const reportAssetLimits = {
  entries: 20_000,
  fileBytes: 128 * 1024 * 1024,
  totalBytes: 512 * 1024 * 1024,
  depth: 64,
} as const;

export interface ReportAsset {
  readonly source: string;
  readonly destination: string;
  readonly size: number;
  readonly ino: number;
  readonly dev: number;
}

export interface ReportAssets {
  readonly inputs: readonly string[];
  readonly files: readonly ReportAsset[];
  readonly links: { readonly allure?: string; readonly coverage?: string };
}

/** Every existing component must be a real directory, including input ancestors. */
async function directories(path: string): Promise<void> {
  let current = parse(path).root;
  for (const part of relative(current, path).split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error(`Unsafe report input directory: ${current}`);
  }
}

export async function collectReportAssets(
  root: string,
  reports: { readonly allure?: string; readonly coverage?: string },
): Promise<ReportAssets> {
  const inputs: string[] = [];
  const files: ReportAsset[] = [];
  const links: { allure?: string; coverage?: string } = {};
  let entries = 0;
  let bytes = 0;
  for (const kind of ["allure", "coverage"] as const) {
    const requested = reports[kind];
    if (requested === undefined) continue;
    if (!requested.trim()) throw new Error(`Empty ${kind} report directory`);
    const input = resolve(root, requested);
    await directories(input);
    inputs.push(await realpath(input));
    const reportFiles: ReportAsset[] = [];
    const walk = async (directory: string, prefix: string, depth: number) => {
      if (depth > reportAssetLimits.depth)
        throw new Error(`Report exceeds directory depth limit: ${directory}`);
      await directories(directory);
      // Stream enumeration so enormous directories cannot exhaust memory.
      const dir = await opendir(directory);
      for await (const entry of dir) {
        if (++entries > reportAssetLimits.entries)
          throw new Error("Report exceeds entry count limit");
        const source = resolve(directory, entry.name);
        const destination = `${prefix}/${entry.name}`;
        const info = await lstat(source);
        if (info.isSymbolicLink())
          throw new Error(`Unsafe report asset symlink: ${source}`);
        if (info.isDirectory()) await walk(source, destination, depth + 1);
        else {
          if (!info.isFile())
            throw new Error(`Unsafe report asset type: ${source}`);
          if (info.size > reportAssetLimits.fileBytes)
            throw new Error(`Report exceeds file size limit: ${source}`);
          bytes += info.size;
          if (bytes > reportAssetLimits.totalBytes)
            throw new Error("Report exceeds total size limit");
          reportFiles.push({
            source,
            destination,
            size: info.size,
            ino: info.ino,
            dev: info.dev,
          });
        }
      }
    };
    await walk(input, kind, 0);
    if (
      reportFiles.some(
        (file) => file.destination === `${kind}/index.html` && file.size > 0,
      )
    ) {
      files.push(...reportFiles);
      links[kind] = `./${kind}/`;
    }
  }
  return { inputs, files, links };
}

/** Snapshot regular files into private staging with bounded reads and exclusive writes. */
export async function stageReportAssets(
  stage: string,
  assets: readonly ReportAsset[],
): Promise<void> {
  for (const asset of assets) {
    await directories(dirname(asset.source));
    const info = await lstat(asset.source);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.ino !== asset.ino ||
      info.dev !== asset.dev ||
      info.size !== asset.size
    )
      throw new Error(`Report asset changed before copying: ${asset.source}`);
    const source = await open(
      asset.source,
      constants.O_RDONLY |
        (process.platform === "win32" ? 0 : constants.O_NOFOLLOW),
    );
    try {
      const opened = await source.stat();
      if (
        !opened.isFile() ||
        opened.ino !== asset.ino ||
        opened.dev !== asset.dev ||
        opened.size !== asset.size
      )
        throw new Error(`Report asset changed while opening: ${asset.source}`);
      const destination = resolve(stage, asset.destination);
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      const target = await open(destination, "wx", 0o600);
      try {
        const buffer = Buffer.alloc(64 * 1024);
        let offset = 0;
        while (offset < asset.size) {
          const { bytesRead } = await source.read(
            buffer,
            0,
            Math.min(buffer.length, asset.size - offset),
            offset,
          );
          if (!bytesRead)
            throw new Error(`Report asset truncated: ${asset.source}`);
          let written = 0;
          while (written < bytesRead) {
            const result = await target.write(
              buffer,
              written,
              bytesRead - written,
              offset + written,
            );
            if (!result.bytesWritten)
              throw new Error(`Could not copy report asset: ${asset.source}`);
            written += result.bytesWritten;
          }
          offset += bytesRead;
        }
        if ((await source.stat()).size !== asset.size)
          throw new Error(`Report asset size changed: ${asset.source}`);
      } finally {
        await target.close();
      }
    } finally {
      await source.close();
    }
  }
}
