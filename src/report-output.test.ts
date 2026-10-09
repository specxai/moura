import {
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it as vitestIt, vi } from "vitest";
import { writeReportOutput } from "./report-output.js";
import { mouraEvidenceTest } from "./test-support/moura-evidence.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});
const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-010/SCN-001/CASE-002"],
  "integration",
);
const roots: string[] = [];
afterEach(async () => {
  vi.mocked(writeFile).mockRestore();
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

  it("rejects an unowned empty directory created during staging without replacing it", async () => {
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
      "not an owned",
    );
    expect((await lstat(output)).ino).toBe(inode);
    expect(await readdir(output)).toEqual([]);
    expect(await readdir(root)).toEqual(["report"]);
  });
});
