import {
  copyFile,
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it as vitestIt, vi } from "vitest";
import { collectReportAssets } from "./report-assets.js";
import { writeReportOutput } from "./report-output.js";
import { mouraEvidenceTest } from "./test-support/moura-evidence.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    copyFile: vi.fn(actual.copyFile),
    open: vi.fn(actual.open),
  };
});
const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-010/SCN-001/CASE-002"],
  "integration",
);
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(writeFile).mockRestore();
  vi.mocked(copyFile).mockRestore();
  vi.mocked(open).mockRestore();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "moura-output-"));
  roots.push(root);
  return { root, output: join(root, "report") };
}
const files = new Map([
  ["index.html", "Overview"],
  ["moura/index.html", "Map"],
]);

describe("private report publication", () => {
  it.skipIf(process.platform === "win32")(
    "keeps staged content behind a private directory until publication",
    async () => {
      const { root, output } = await fixture();
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      let observed = false;
      vi.mocked(writeFile).mockImplementation(async (...args) => {
        const path = String(args[0]);
        const relative = path.slice(root.length + 1).split(/[\\/]/u);
        const container = join(root, relative[0]!);
        expect(relative[0]).toMatch(/^\.moura-stage-/u);
        expect((await lstat(container)).mode & 0o777).toBe(0o700);
        expect(await readdir(root)).not.toContain("report");
        observed = true;
        return actual.writeFile(...args);
      });
      await writeReportOutput(root, output, [], files);
      expect(observed).toBe(true);
      expect(await readdir(root)).toEqual(["report"]);
      expect((await lstat(output)).mode & 0o777).toBe(0o777 & ~process.umask());
    },
  );

  it("rejects a competing empty directory created during staging without replacing it", async () => {
    const { root, output } = await fixture();
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    let inode: number | undefined;
    vi.mocked(writeFile).mockImplementationOnce(async (...args) => {
      await mkdir(output);
      inode = (await lstat(output)).ino;
      return actual.writeFile(...args);
    });
    await expect(writeReportOutput(root, output, [], files)).rejects.toThrow(
      "Output already exists",
    );
    expect((await lstat(output)).ino).toBe(inode);
    expect(await readdir(output)).toEqual([]);
    expect(await readdir(root)).toEqual(["report"]);
  });
  it("cleans staging after a generation failure without publishing output", async () => {
    const { root, output } = await fixture();
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("generation failed"));
    await expect(writeReportOutput(root, output, [], files)).rejects.toThrow(
      "generation failed",
    );
    expect(await readdir(root)).toEqual([]);
  });
  it("rolls back partial publication after a copy failure", async () => {
    const { root, output } = await fixture();
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.mocked(copyFile)
      .mockImplementationOnce(actual.copyFile)
      .mockRejectedValueOnce(new Error("publication failed"));
    await expect(writeReportOutput(root, output, [], files)).rejects.toThrow(
      "publication failed",
    );
    expect(await readdir(root)).toEqual([]);
  });
  it("preserves a competing file during publication and removes only its own output", async () => {
    const { root, output } = await fixture();
    const actual =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    let competingFile = "";
    vi.mocked(copyFile).mockImplementationOnce(async (...args) => {
      competingFile = String(args[1]);
      await actual.writeFile(competingFile, "user sentinel");
      return actual.copyFile(...args);
    });
    await expect(writeReportOutput(root, output, [], files)).rejects.toThrow();
    expect(await actual.readFile(competingFile, "utf8")).toBe("user sentinel");
    expect(await readdir(output)).toEqual(["moura"]);
    expect(await readdir(join(output, "moura"))).toEqual(["index.html"]);
    expect(await readdir(root)).toEqual(["report"]);
  });
  it.each(["staging", "publication", "collision"])(
    "cleans imported assets after a mid-copy %s failure and preserves inputs",
    async (phase) => {
      const { root, output } = await fixture();
      const input = join(root, "html");
      await mkdir(input);
      const content = "x".repeat(128 * 1024);
      await writeFile(join(input, "index.html"), content);
      const assets = await collectReportAssets(root, { allure: "html" });
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      if (phase === "staging") {
        vi.mocked(open).mockImplementationOnce(async (...args) => {
          const handle = await actual.open(...args);
          const read = handle.read.bind(handle);
          vi.spyOn(handle, "read")
            .mockImplementationOnce(read)
            .mockRejectedValueOnce(new Error("asset read failed"));
          return handle;
        });
      } else if (phase === "publication") {
        vi.mocked(copyFile).mockImplementation(async (...args) => {
          if (String(args[1]).endsWith(join("allure", "index.html")))
            throw new Error("asset publication failed");
          return actual.copyFile(...args);
        });
      }
      await expect(
        writeReportOutput(
          root,
          output,
          assets.inputs,
          files,
          phase === "collision"
            ? [...assets.files, ...assets.files]
            : assets.files,
        ),
      ).rejects.toThrow(phase === "collision" ? /EEXIST/u : /asset .*failed/u);
      expect(await readdir(root)).toEqual(["html"]);
      expect(await readFile(join(input, "index.html"), "utf8")).toBe(content);
    },
  );
  it.each([
    "allure/../../escape.html",
    "coverage/../escape.html",
    "allure/./asset.html",
    "allure//asset.html",
    "/escape.html",
    ...(process.platform === "win32" ? ["allure/..\\..\\escape.html"] : []),
  ])("rejects asset path traversal %s before staging", async (destination) => {
    const { root, output } = await fixture();
    await expect(
      writeReportOutput(root, output, [], files, [
        { source: join(root, "input"), destination, size: 0, ino: 0, dev: 0 },
      ]),
    ).rejects.toThrow("Invalid report asset");
    expect(await readdir(root)).toEqual([]);
  });
});
