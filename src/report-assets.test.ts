import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it as vitestIt, vi } from "vitest";
import {
  collectReportAssets,
  reportAssetLimits,
  stageReportAssets,
} from "./report-assets.js";
import { reportProjectDirectory } from "./report.js";
import { collectQualityOverview } from "./quality-overview.js";
import { mouraEvidenceTest } from "./test-support/moura-evidence.js";

const it = mouraEvidenceTest(
  vitestIt,
  ["REQ-010/SCN-001/CASE-004"],
  "integration",
);
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "moura-assets-"));
  roots.push(root);
  await cp(resolve("examples/vitest-minimal"), root, { recursive: true });
  for (const kind of ["external-allure", "external-coverage"]) {
    await mkdir(join(root, kind, "assets"), { recursive: true });
    await writeFile(
      join(root, kind, "index.html"),
      '<link href="assets/style.css"><script src="assets/app.js"></script><img src="assets/icon.png"><a href="assets/detail.html">Detail</a>',
    );
    for (const [name, content] of [
      ["style.css", "body { color: green }"],
      ["app.js", "console.log('ok')"],
      ["detail.html", '<a href="../index.html">Back</a>'],
      ["data.json", '{"total":999}'],
    ])
      await writeFile(join(root, kind, "assets", name!), content!);
    await writeFile(
      join(root, kind, "assets/icon.png"),
      Buffer.from([0, 255, 10]),
    );
  }
  await mkdir(join(root, "allure-results"));
  await writeFile(
    join(root, "allure-results/test-result.json"),
    JSON.stringify({
      status: "passed",
      labels: [
        { name: "moura_requirement", value: "REQ-001" },
        { name: "moura_scenario", value: "SCN-001" },
        { name: "moura_case", value: "CASE-001" },
        { name: "moura_layer", value: "unit" },
      ],
    }),
  );
  await mkdir(join(root, "coverage"));
  await writeFile(
    join(root, "coverage/coverage-summary.json"),
    JSON.stringify({
      total: Object.fromEntries(
        ["lines", "statements", "functions", "branches"].map((metric) => [
          metric,
          { pct: 73 },
        ]),
      ),
    }),
  );
  return root;
}

describe("external HTML report imports", () => {
  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])(
    "bundles allure=%s coverage=%s without changing authoritative metrics",
    async (allure, coverage) => {
      const root = await fixture();
      const baseline = await collectQualityOverview(root);
      const result = await reportProjectDirectory(root, {
        output: "quality",
        ...(allure ? { allureReport: "external-allure" } : {}),
        ...(coverage
          ? { coverageReport: join(root, "external-coverage") }
          : {}),
      });
      expect(result.exitCode, result.errors.join("\n")).toBe(0);
      const overview = await readFile(result.overviewPath!, "utf8");
      expect(overview).toContain(`data-status="${baseline.status}"`);
      expect(overview).toContain("73%");
      expect(await collectQualityOverview(root)).toEqual(baseline);
      for (const [enabled, kind, source] of [
        [allure, "allure", "external-allure"],
        [coverage, "coverage", "external-coverage"],
      ] as const) {
        expect(overview.includes(`href="./${kind}/"`)).toBe(enabled);
        if (!enabled) {
          await expect(lstat(join(root, "quality", kind))).rejects.toThrow();
          continue;
        }
        for (const file of [
          "index.html",
          "assets/style.css",
          "assets/app.js",
          "assets/icon.png",
          "assets/detail.html",
          "assets/data.json",
        ])
          expect(await readFile(join(root, "quality", kind, file))).toEqual(
            await readFile(join(root, source, file)),
          );
        const entry = join(root, "quality", kind, "index.html");
        for (const [, href] of (await readFile(entry, "utf8")).matchAll(
          /(?:href|src)="([^"]+)"/gu,
        ))
          await expect(
            lstat(resolve(dirname(entry), href!)),
          ).resolves.toBeDefined();
        await expect(
          lstat(resolve(dirname(entry), "assets/../index.html")),
        ).resolves.toBeDefined();
      }
      expect(await readFile(result.outputPath!, "utf8")).toContain(
        "sources/source-",
      );
    },
  );
  it.each(["missing", "empty"])(
    "omits links when the entry HTML is %s",
    async (mode) => {
      const root = await fixture();
      const entry = join(root, "external-allure/index.html");
      if (mode === "missing") await rm(entry);
      else await writeFile(entry, "");
      const result = await reportProjectDirectory(root, {
        allureReport: "external-allure",
      });
      expect(result.overviewPath).toBeDefined();
      expect(await readFile(result.overviewPath!, "utf8")).not.toContain(
        'href="./allure/"',
      );
      await expect(lstat(join(root, "moura-report/allure"))).rejects.toThrow();
    },
  );
  it.each(["nonexistent", "external-allure/index.html", ""])(
    "rejects invalid input %j before publication",
    async (input) => {
      const root = await fixture();
      const result = await reportProjectDirectory(root, {
        allureReport: input,
      });
      expect(result.exitCode).toBe(1);
      expect(result.overviewPath).toBeUndefined();
      await expect(lstat(join(root, "moura-report"))).rejects.toThrow();
      expect(
        await readFile(join(root, "requirements.md"), "utf8"),
      ).toBeTruthy();
    },
  );
  it.each(["external-allure/nested", "external-allure", "."])(
    "rejects input/output overlap %s",
    async (output) => {
      const root = await fixture();
      const original = await readFile(join(root, "external-allure/index.html"));
      const result = await reportProjectDirectory(root, {
        allureReport: "external-allure",
        output,
      });
      expect(result.exitCode).toBe(1);
      expect(result.overviewPath).toBeUndefined();
      expect(await readFile(join(root, "external-allure/index.html"))).toEqual(
        original,
      );
    },
  );
  it.each(["report", "empty"])("preserves existing %s output", async (mode) => {
    const root = await fixture();
    await mkdir(join(root, "quality"));
    if (mode === "report")
      await writeFile(join(root, "quality/index.html"), "sentinel");
    const result = await reportProjectDirectory(root, {
      allureReport: "external-allure",
      output: "quality",
    });
    expect(result.errors.join()).toContain("Output already exists");
    expect(await readdir(join(root, "quality"))).toEqual(
      mode === "empty" ? [] : ["index.html"],
    );
    if (mode === "report")
      expect(await readFile(join(root, "quality/index.html"), "utf8")).toBe(
        "sentinel",
      );
  });
  it.each(["ancestor", "directory", "file", "dangling"])(
    "rejects %s symlinks",
    async (kind) => {
      const root = await fixture();
      // Windows junctions do not require developer mode or symbolic-link privilege.
      if (
        kind === "ancestor" ||
        kind === "directory" ||
        process.platform === "win32"
      ) {
        const link =
          kind === "ancestor"
            ? join(root, "alias")
            : join(root, "external-allure/alias");
        await symlink(root, link, "junction");
      } else
        await symlink(
          kind === "dangling"
            ? join(root, "absent")
            : join(root, "requirements.md"),
          join(root, "external-allure/unsafe"),
        );
      const result = await reportProjectDirectory(root, {
        allureReport:
          kind === "ancestor" ? "alias/external-allure" : "external-allure",
      });
      expect(result.exitCode).toBe(1);
      expect(result.errors.join()).toMatch(/Unsafe/u);
      await expect(lstat(join(root, "moura-report"))).rejects.toThrow();
    },
  );
  it.each([
    "COM0.js",
    "com0.js",
    "CoM0.js",
    "LPT0.html",
    "lpt0.html",
    "LpT0.html",
  ])("imports non-reserved device number zero asset %s", async (name) => {
    const root = await fixture();
    await writeFile(join(root, "external-allure", name), "zero device asset");
    const result = await reportProjectDirectory(root, {
      allureReport: "external-allure",
    });
    expect(result.exitCode, result.errors.join("\n")).toBe(0);
    expect(
      await readFile(join(root, "moura-report/allure", name), "utf8"),
    ).toBe("zero device asset");
  });
  it
    .skipIf(process.platform === "win32")
    .each([
      ...["CON", "PRN", "AUX", "NUL"].flatMap((name) => [
        name,
        `${name.toLowerCase()}.txt`,
      ]),
      ...["COM", "LPT"].flatMap((prefix) =>
        [..."123456789¹²³"].flatMap((number) => [
          `${prefix}${number}`,
          `${prefix.toLowerCase()}${number}.html`,
        ]),
      ),
      "unsafe\\name",
      "trailing.",
      "colon:name",
      "case-collision",
    ])("rejects non-portable names %s on POSIX as well", async (name) => {
    const root = await fixture();
    if (name === "case-collision") {
      await writeFile(join(root, "external-allure/FILE"), "one");
      await writeFile(join(root, "external-allure/file"), "two");
    } else await writeFile(join(root, "external-allure", name), "bad");
    await expect(
      collectReportAssets(root, { allure: "external-allure" }),
    ).rejects.toThrow("Non-portable");
  });
  it("enforces file size limits without reading oversized content", async () => {
    const root = await fixture();
    const file = await open(join(root, "external-allure/oversized.dat"), "w");
    try {
      await file.truncate(reportAssetLimits.fileBytes + 1);
    } finally {
      await file.close();
    }
    const result = await reportProjectDirectory(root, {
      allureReport: "external-allure",
    });
    expect(result.errors.join()).toContain("file size limit");
    expect(result.overviewPath).toBeUndefined();
  });
  it("rejects changed or truncated sources before staging them", async () => {
    const root = await fixture();
    const assets = await collectReportAssets(root, {
      allure: "external-allure",
    });
    const source = assets.files[0]!.source;
    await writeFile(source, "changed-size");
    const stage = join(root, "stage");
    await mkdir(stage);
    await expect(stageReportAssets(stage, assets.files)).rejects.toThrow(
      "changed",
    );
  });
  it("enforces aggregate bytes before any copying", async () => {
    const root = await fixture();
    for (let index = 0; index < 5; index++) {
      const handle = await open(
        join(root, "external-allure", `large-${index}.bin`),
        "w",
      );
      try {
        await handle.truncate(reportAssetLimits.fileBytes);
      } finally {
        await handle.close();
      }
    }
    await expect(
      collectReportAssets(root, { allure: "external-allure" }),
    ).rejects.toThrow("total size limit");
  });
  it("rejects excessive nesting before copying", async () => {
    const root = await fixture();
    await mkdir(
      join(
        root,
        "external-allure",
        ...Array<string>(reportAssetLimits.depth + 1).fill("nested"),
      ),
      { recursive: true },
    );
    await expect(
      collectReportAssets(root, { allure: "external-allure" }),
    ).rejects.toThrow("depth limit");
  });
  it("enforces the entry limit across directories", async () => {
    const root = await fixture();
    // Empty files still consume the count budget.
    for (let group = 0; group < 20; group++) {
      const directory = join(root, "external-allure", `group-${group}`);
      await mkdir(directory);
      await Promise.all(
        Array.from({ length: 1000 }, (_, index) =>
          writeFile(join(directory, `${index}.dat`), ""),
        ),
      );
    }
    await expect(
      collectReportAssets(root, { allure: "external-allure" }),
    ).rejects.toThrow("entry count limit");
  }, 30_000);
});
