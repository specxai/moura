import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it as vitestIt } from "vitest";

import { parseManifest } from "./manifest.js";
import { parseSpecificationMarkdown } from "./markdown.js";
import {
  mouraEvidenceName,
  mouraEvidenceTest,
} from "./test-support/moura-evidence.js";
import {
  isValidProjectRelativeSourcePath,
  loadProjectDirectory,
  validateProject,
  validateProjectDirectory,
} from "./project.js";

const it = mouraEvidenceTest(vitestIt, ["REQ-001/SCN-001/CASE-014"], "unit");

const validManifest = `
version: 1
sources:
  requirements: [req.md]
  specifications: [spec.md]
verification:
  layers: [unit]
requirements:
  - id: REQ-001
    scenarios:
      - id: SCN-001
        cases:
          - id: CASE-001
            verify: [unit]
`;
const validRequirement = "# Requirements\n\n## REQ-001 A title\n";
const validSpecification =
  "# Specification\n\n## REQ-001 A title\n### SCN-001 Behavior\n#### CASE-001 Example\n";

const sourcePathCases = [
  { category: "valid", path: "req.md", valid: true },
  { category: "valid", path: "./req.md", valid: true },
  { category: "valid", path: "docs/req.md", valid: true },
  {
    category: "valid",
    path: "docs/specifications/spec.md",
    valid: true,
  },
  { category: "valid", path: "docs/../req.md", valid: true },
  { category: "valid", path: "docs/sub/../req.md", valid: true },
  { category: "absolute", path: "/req.md", valid: false },
  { category: "absolute", path: "/docs/req.md", valid: false },
  { category: "absolute", path: "C:\\docs\\req.md", valid: false },
  { category: "absolute", path: "C:/docs/req.md", valid: false },
  { category: "drive-qualified", path: "C:req.md", valid: false },
  { category: "drive-qualified", path: "C:docs/req.md", valid: false },
  { category: "drive-qualified", path: "D:spec.md", valid: false },
  { category: "project-root escape", path: "../req.md", valid: false },
  { category: "project-root escape", path: "../../req.md", valid: false },
  {
    category: "project-root escape",
    path: "../project/req.md",
    valid: false,
  },
  {
    category: "project-root escape",
    path: "docs/../../req.md",
    valid: false,
  },
  { category: "normalizes to root", path: "", valid: false },
  { category: "normalizes to root", path: ".", valid: false },
  { category: "normalizes to root", path: "./", valid: false },
  { category: "normalizes to root", path: "docs/..", valid: false },
  {
    category: "normalizes to root",
    path: "docs/sub/../..",
    valid: false,
  },
  { category: "directory-denoting", path: "req.md/", valid: false },
  { category: "directory-denoting", path: "docs/", valid: false },
  { category: "directory-denoting", path: "docs/.", valid: false },
  { category: "directory-denoting", path: "docs/sub/.", valid: false },
  { category: "directory-denoting", path: "docs/../", valid: false },
  { category: "filesystem-impossible", path: "req\0.md", valid: false },
  {
    category: "filesystem-impossible",
    path: "docs/\0req.md",
    valid: false,
  },
] as const;

function validate(
  manifest = validManifest,
  requirement = validRequirement,
  specification = validSpecification,
) {
  return validateProject({
    manifest,
    requirementSources: new Map([["req.md", requirement]]),
    specificationSources: new Map([["spec.md", specification]]),
  });
}
function codes(
  manifest: string,
  requirement?: string,
  specification?: string,
): string[] {
  return validate(manifest, requirement, specification).errors.map(
    (item) => item.code,
  );
}

describe("manifest parsing and validation", () => {
  it("enforces the configured source path contract", () => {
    for (const testCase of sourcePathCases) {
      expect(
        isValidProjectRelativeSourcePath(testCase.path),
        `${testCase.category}: ${JSON.stringify(testCase.path)}`,
      ).toBe(testCase.valid);
    }
  });

  it(
    mouraEvidenceName(
      "accepts a valid manifest",
      ["REQ-001/SCN-001/CASE-001"],
      "unit",
    ),
    () => expect(validate().errors).toEqual([]),
  );

  it("accepts an explicit unimplemented layer without a verify list", () => {
    const source = validManifest.replace(
      "verify: [unit]",
      "unimplemented: [unit]",
    );
    const result = validate(source);
    expect(result.errors).toEqual([]);
    const parsed = parseManifest(source);
    expect(parsed.value?.requirements[0]?.scenarios[0]?.cases[0]).toMatchObject(
      { verify: [], unimplemented: ["unit"] },
    );
  });

  it("rejects duplicate and unknown unimplemented layer declarations", () => {
    expect(
      codes(
        validManifest.replace(
          "verify: [unit]",
          "verify: [unit]\n            unimplemented: [unit]",
        ),
      ),
    ).toContain("duplicate-verify-layer");
    expect(
      codes(validManifest.replace("verify: [unit]", "unimplemented: [other]")),
    ).toContain("unknown-verification-layer");
  });

  it(
    mouraEvidenceName(
      "rejects unsafe local IDs and verification-layer names at the project boundary",
      ["REQ-001/SCN-001/CASE-008", "REQ-001/SCN-001/CASE-011"],
      "unit",
    ),
    () => {
      for (const escaped of [
        "\\u0000",
        "\\u0001",
        "\\u007f",
        "\\u009f",
        "\\ud800",
        "\\udfff",
      ]) {
        for (const id of ["REQ-001", "SCN-001", "CASE-001"])
          expect(
            codes(validManifest.replace(id, `"${id}-${escaped}"`)),
          ).toContain("invalid-local-id");
        expect(
          codes(
            validManifest
              .replace("[unit]", `["layer-${escaped}"]`)
              .replace("verify: [unit]", `verify: ["layer-${escaped}"]`),
          ),
        ).toContain("invalid-verification-layer");
      }
    },
  );

  it(
    mouraEvidenceName(
      "accepts ordinary and supplementary Unicode identifiers and layer names",
      ["REQ-001/SCN-001/CASE-008", "REQ-001/SCN-001/CASE-011"],
      "unit",
    ),
    () => {
      const result = validate(
        validManifest
          .replaceAll("REQ-001", "要件-一")
          .replaceAll("SCN-001", "場面-😀")
          .replaceAll("CASE-001", "事例-𠮷")
          .replaceAll("unit", "層-🚀"),
        validRequirement.replace("REQ-001", "要件-一"),
        validSpecification
          .replace("REQ-001", "要件-一")
          .replace("SCN-001", "場面-😀")
          .replace("CASE-001", "事例-𠮷"),
      );
      expect(result.errors).toEqual([]);
    },
  );

  it(
    mouraEvidenceName(
      "rejects a missing or unsupported version",
      ["REQ-001/SCN-001/CASE-002"],
      "unit",
    ),
    () => {
      expect(
        codes(validManifest.replace("version: 1", "version: 2")).includes(
          "unsupported-version",
        ),
      ).toBeTruthy();
      expect(
        codes(validManifest.replace("version: 1\n", "")).includes(
          "unsupported-version",
        ),
      ).toBeTruthy();
    },
  );

  it("rejects duplicate YAML mapping keys", () => {
    const result = parseManifest(`version: 1\nversion: 1\n`);
    expect(
      result.errors.some((item) => item.code === "invalid-yaml"),
    ).toBeTruthy();
    expect(result.errors[0]?.message ?? "").toMatch(
      /unique|map keys|duplicate/iu,
    );
  });

  it("propagates a custom manifest source to every parsing error", () => {
    const nested = parseManifest(
      `
version: 2
unexpected: true
sources:
  unexpected: true
  requirements: wrong
verification:
  unexpected: true
  layers: [1]
requirements:
  - unexpected: true
    scenarios:
      - id: SCN-001
        unexpected: true
        cases:
          - unexpected: true
            verify: wrong
`,
      "config/custom.yaml",
    );
    const missingMappings = parseManifest(
      "version: 1\nsources: wrong\nverification: wrong\nrequirements: wrong\n",
      "config/custom.yaml",
    );
    const errors = [...nested.errors, ...missingMappings.errors];
    expect(errors.length > 0).toBeTruthy();
    expect(
      errors.some((item) => item.code === "unsupported-version"),
    ).toBeTruthy();
    expect(errors.some((item) => item.code === "unknown-field")).toBeTruthy();
    expect(
      errors.some((item) => item.code === "invalid-manifest"),
    ).toBeTruthy();
    expect(new Set(errors.map((item) => item.source))).toEqual(
      new Set(["config/custom.yaml"]),
    );
  });

  it("keeps moura.yaml as the default manifest error source", () => {
    const result = parseManifest("version: 2\n");
    expect(result.errors.length > 0).toBeTruthy();
    expect(
      result.errors.every((item) => item.source === "moura.yaml"),
    ).toBeTruthy();
  });

  describe("YAML features in the v0.1 manifest contract", () => {
    const aliasManifests = [
      {
        name: "sequence alias",
        manifest: validManifest
          .replace("  layers: [unit]", "  layers: &layers [unit]")
          .replace("            verify: [unit]", "            verify: *layers"),
      },
      {
        name: "mapping alias used as a list item",
        manifest: validManifest.replace(
          "  - id: REQ-001",
          "  - &requirement\n    id: REQ-001\n    scenarios: []\n  - *requirement",
        ),
      },
      {
        name: "scalar alias used as a list item",
        manifest: validManifest
          .replace("  layers: [unit]", "  layers: [&unit unit]")
          .replace("            verify: [unit]", "            verify: [*unit]"),
      },
    ] as const;

    for (const testCase of aliasManifests) {
      it(`rejects a ${testCase.name} explicitly`, () => {
        const result = parseManifest(testCase.manifest);
        const aliasErrors = result.errors.filter(
          (item) => item.code === "unsupported-yaml-alias",
        );
        expect(aliasErrors.length).toBe(1);
        expect(aliasErrors[0]?.message ?? "").toMatch(
          /unsupported YAML alias/u,
        );
      });
    }

    it("rejects an anchor even when it is not referenced", () => {
      const result = parseManifest(
        validManifest.replace("  layers: [unit]", "  layers: &layers [unit]"),
      );
      expect(
        result.errors.some((item) => item.code === "unsupported-yaml-anchor"),
      ).toBeTruthy();
    });

    it("continues to accept a normal manifest", () => {
      expect(parseManifest(validManifest).errors).toEqual([]);
    });
  });

  it(
    mouraEvidenceName(
      "reports duplicate Requirements, Scenarios, and Cases",
      [
        "REQ-001/SCN-001/CASE-005",
        "REQ-001/SCN-001/CASE-006",
        "REQ-001/SCN-001/CASE-007",
        "REQ-001/SCN-001/CASE-012",
      ],
      "unit",
    ),
    () => {
      const manifest = validManifest
        .replace(
          "  - id: REQ-001",
          "  - id: REQ-001\n    scenarios: []\n  - id: REQ-001",
        )
        .replace(
          "      - id: SCN-001",
          "      - id: SCN-001\n        cases: []\n      - id: SCN-001",
        )
        .replace(
          "          - id: CASE-001",
          "          - id: CASE-001\n            verify: [unit]\n          - id: CASE-001",
        );
      const found = codes(manifest);
      expect(found.includes("duplicate-requirement")).toBeTruthy();
      expect(found.includes("duplicate-scenario")).toBeTruthy();
      expect(found.includes("duplicate-case")).toBeTruthy();
      expect(found.includes("duplicate-canonical-id")).toBeTruthy();
    },
  );

  it(
    mouraEvidenceName(
      "reports missing Scenario, Case, and verify lists",
      ["REQ-001/SCN-001/CASE-009", "REQ-001/SCN-001/CASE-010"],
      "unit",
    ),
    () => {
      expect(
        codes(
          validManifest.replace(
            / {4}scenarios:[\s\S]*$/u,
            "    scenarios: []\n",
          ),
        ).includes("missing-scenario"),
      ).toBeTruthy();
      expect(
        codes(
          validManifest.replace(/ {8}cases:[\s\S]*$/u, "        cases: []\n"),
        ).includes("missing-case"),
      ).toBeTruthy();
      expect(
        codes(
          validManifest.replace(
            "            verify: [unit]",
            "            verify: []",
          ),
        ).includes("missing-verify"),
      ).toBeTruthy();
    },
  );

  it(
    mouraEvidenceName(
      "reports unknown and duplicate verification layers",
      ["REQ-001/SCN-001/CASE-011"],
      "unit",
    ),
    () => {
      expect(
        codes(
          validManifest.replace("verify: [unit]", "verify: [other]"),
        ).includes("unknown-verification-layer"),
      ).toBeTruthy();
      expect(
        codes(
          validManifest.replace("layers: [unit]", "layers: [unit, unit]"),
        ).includes("duplicate-verification-layer"),
      ).toBeTruthy();
      expect(
        codes(
          validManifest.replace("verify: [unit]", "verify: [unit, unit]"),
        ).includes("duplicate-verify-layer"),
      ).toBeTruthy();
    },
  );

  it(
    mouraEvidenceName(
      "uses localId validation including Unicode White_Space",
      ["REQ-001/SCN-001/CASE-008"],
      "unit",
    ),
    () => {
      expect(codes(validManifest.replace("id: CASE-001", 'id: ""'))).toContain(
        "invalid-local-id",
      );
      expect(
        codes(validManifest.replace("REQ-001", "BAD/ID")).includes(
          "invalid-local-id",
        ),
      ).toBeTruthy();
      expect(
        codes(validManifest.replace("SCN-001", "SCN-\u0085001")).includes(
          "invalid-local-id",
        ),
      ).toBeTruthy();
    },
  );

  it("requires requirement and specification source entries", () => {
    expect(
      codes(
        validManifest.replace("requirements: [req.md]", "requirements: []"),
      ).includes("missing-requirement-source"),
    ).toBeTruthy();
    expect(
      codes(
        validManifest.replace(
          "specifications: [spec.md]",
          "specifications: []",
        ),
      ).includes("missing-specification-source"),
    ).toBeTruthy();
  });

  it(
    mouraEvidenceName(
      "reports configured source files that cannot be read",
      ["REQ-001/SCN-001/CASE-003"],
      "integration",
    ),
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "moura-test-"));
      try {
        await writeFile(join(directory, "moura.yaml"), validManifest);
        const result = await validateProjectDirectory(directory);
        expect(
          result.errors.filter((item) => item.code === "unreadable-source")
            .length,
        ).toBe(2);
      } finally {
        await rm(directory, { recursive: true });
      }
    },
  );

  it(
    mouraEvidenceName(
      "returns the validated manifest from the canonical filesystem boundary",
      ["REQ-001/SCN-001/CASE-001"],
      "integration",
    ),
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "moura-test-"));
      try {
        await Promise.all([
          writeFile(join(directory, "moura.yaml"), validManifest),
          writeFile(join(directory, "req.md"), validRequirement),
          writeFile(join(directory, "spec.md"), validSpecification),
        ]);
        const loaded = await loadProjectDirectory(directory);
        expect(loaded.errors).toEqual([]);
        expect(loaded.manifest?.requirements[0]?.localId).toBe("REQ-001");
      } finally {
        await rm(directory, { recursive: true });
      }
    },
  );

  it("rejects source paths outside the project directory before reading", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-test-"));
    try {
      for (const source of [
        "../outside.md",
        "/tmp/outside.md",
        "C:\\outside.md",
      ]) {
        const manifest = validManifest.replace("req.md", source);
        await writeFile(join(directory, "moura.yaml"), manifest);
        const result = await validateProjectDirectory(directory);
        expect(
          result.errors.filter((item) => item.code === "invalid-source-path")
            .length,
          source,
        ).toBe(1);
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("rejects a configured source that resolves through a symlink outside the project", async () => {
    const parent = await mkdtemp(join(tmpdir(), "moura-test-"));
    const directory = join(parent, "project");
    try {
      await mkdir(directory);
      await writeFile(join(directory, "moura.yaml"), validManifest);
      await writeFile(join(directory, "spec.md"), validSpecification);
      await writeFile(join(parent, "outside.md"), validRequirement);
      await symlink(join(parent, "outside.md"), join(directory, "req.md"));
      const result = await validateProjectDirectory(directory);
      expect(
        result.errors.some((item) => item.code === "invalid-source-path"),
      ).toBeTruthy();
    } finally {
      await rm(parent, { recursive: true });
    }
  });

  it("allows a configured source that resolves through an internal symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-test-"));
    try {
      await writeFile(join(directory, "moura.yaml"), validManifest);
      await writeFile(join(directory, "actual-req.md"), validRequirement);
      await symlink("actual-req.md", join(directory, "req.md"));
      await writeFile(join(directory, "spec.md"), validSpecification);
      expect((await validateProjectDirectory(directory)).errors).toEqual([]);
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("rejects a manifest symlink that resolves outside the project", async () => {
    const parent = await mkdtemp(join(tmpdir(), "moura-test-"));
    const directory = join(parent, "project");
    try {
      await mkdir(directory);
      await writeFile(join(parent, "outside.yaml"), validManifest);
      await symlink(
        join(parent, "outside.yaml"),
        join(directory, "moura.yaml"),
      );
      const result = await validateProjectDirectory(directory);
      expect(
        result.errors.some((item) => item.code === "invalid-source-path"),
      ).toBeTruthy();
    } finally {
      await rm(parent, { recursive: true });
    }
  });

  it("allows a manifest symlink that resolves inside the real project root", async () => {
    const parent = await mkdtemp(join(tmpdir(), "moura-test-"));
    const directory = join(parent, "project");
    const linkedDirectory = join(parent, "linked-project");
    try {
      await mkdir(directory);
      await mkdir(join(directory, "config"));
      await writeFile(join(directory, "config", "moura.yaml"), validManifest);
      await symlink("config/moura.yaml", join(directory, "moura.yaml"));
      await writeFile(join(directory, "req.md"), validRequirement);
      await writeFile(join(directory, "spec.md"), validSpecification);
      await symlink(directory, linkedDirectory);
      expect((await validateProjectDirectory(linkedDirectory)).errors).toEqual(
        [],
      );
    } finally {
      await rm(parent, { recursive: true });
    }
  });

  it("does not substitute an unrelated source-map entry for a configured path", () => {
    const result = validateProject({
      manifest: validManifest,
      requirementSources: new Map([["other.md", validRequirement]]),
      specificationSources: new Map([["spec.md", validSpecification]]),
    });
    expect(
      result.errors.some((item) => item.code === "missing-source"),
    ).toBeTruthy();
    expect(
      result.errors.some(
        (item) => item.code === "missing-requirement-markdown",
      ),
    ).toBeTruthy();
  });

  it("rejects non-project-relative paths before source-map lookup", () => {
    for (const { path: source } of sourcePathCases.filter(
      (testCase) => !testCase.valid,
    )) {
      const manifest = validManifest.replace("req.md", JSON.stringify(source));
      const result = validateProject({
        manifest,
        requirementSources: new Map([[source, validRequirement]]),
        specificationSources: new Map([["spec.md", validSpecification]]),
      });
      expect(
        result.errors.some(
          (item) =>
            item.code === "invalid-source-path" && item.source === source,
        ),
        `requirement source ${JSON.stringify(source)}`,
      ).toBeTruthy();
    }
  });

  it("accepts normalized project-relative source paths", () => {
    for (const { path: source } of sourcePathCases.filter(
      (testCase) => testCase.valid,
    )) {
      const manifest = validManifest.replace("req.md", JSON.stringify(source));
      const result = validateProject({
        manifest,
        requirementSources: new Map([[source, validRequirement]]),
        specificationSources: new Map([["spec.md", validSpecification]]),
      });
      expect(result.errors, source).toEqual([]);
    }
  });

  it("reports one contract diagnostic per unsafe directory source", async () => {
    const directory = await mkdtemp(join(tmpdir(), "moura-test-"));
    try {
      await writeFile(join(directory, "spec.md"), validSpecification);
      for (const { path: source } of sourcePathCases.filter(
        (testCase) => !testCase.valid,
      )) {
        await writeFile(
          join(directory, "moura.yaml"),
          validManifest.replace("req.md", JSON.stringify(source)),
        );
        const result = await validateProjectDirectory(directory);
        expect(
          result.errors.filter(
            (item) =>
              item.code === "invalid-source-path" && item.source === source,
          ).length,
          source,
        ).toBe(1);
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("collects multiple independent errors", () => {
    const found = codes(
      validManifest
        .replace("verify: [unit]", "verify: [other, other]")
        .replace("layers: [unit]", "layers: []"),
    );
    expect(found.length >= 3).toBeTruthy();
    expect(found.includes("duplicate-verify-layer")).toBeTruthy();
    expect(found.includes("unknown-verification-layer")).toBeTruthy();
  });
});

describe("Markdown hierarchy and canonical matching", () => {
  it("extracts ID tokens rather than complete heading text", () => {
    const parsed = parseManifest(validManifest).value!;
    const result = parseSpecificationMarkdown(
      validSpecification,
      "spec.md",
      parsed,
    );
    expect(result.value?.requirements[0]?.scenarios[0]?.cases).toEqual([
      "CASE-001",
    ]);
  });

  it("ignores heading-like content in backtick and tilde fences", () => {
    const fenced = `${validSpecification}
\`\`\`md
## REQ-999
### SCN-999
#### CASE-999
\`\`\`
~~~markdown
## REQ-998
### SCN-998
#### CASE-998
~~~~
`;
    expect(validate(validManifest, validRequirement, fenced).errors).toEqual(
      [],
    );
  });

  it("ignores headings in block and single-line HTML comments", () => {
    const commented = `${validSpecification}
<!--
## REQ-999 Disabled requirement
### SCN-999 Disabled scenario
#### CASE-999 Disabled case
-->
<!-- ## REQ-998 Disabled requirement -->
`;
    expect(validate(validManifest, validRequirement, commented).errors).toEqual(
      [],
    );
  });

  it("does not recognize a Requirement heading inside a blockquote", () => {
    const errors = validate(
      validManifest,
      "> ## REQ-001 Retired requirement\n",
      validSpecification,
    ).errors;
    expect(
      errors.some((item) => item.code === "missing-requirement-markdown"),
    ).toBeTruthy();
  });

  it("does not satisfy the specification with a quoted hierarchy", () => {
    const quoted = [
      "> ## REQ-001 Old requirement",
      ">",
      "> ### SCN-001 Old scenario",
      ">",
      "> #### CASE-001 Old case",
      "",
    ].join("\n");
    const errors = validate(validManifest, validRequirement, quoted).errors;
    expect(
      errors.some((item) => item.code === "missing-specification-requirement"),
    ).toBeTruthy();
    expect(
      errors.some((item) => item.code === "missing-specification-scenario"),
    ).toBeTruthy();
    expect(
      errors.some((item) => item.code === "missing-specification-case"),
    ).toBeTruthy();
  });

  it("recognizes a top-level Requirement, Scenario, and Case hierarchy", () => {
    expect(
      validate(validManifest, validRequirement, validSpecification).errors,
    ).toEqual([]);
  });

  it("does not recognize a heading nested inside a list", () => {
    const errors = validate(
      validManifest,
      "- ## REQ-001 Listed requirement\n",
      validSpecification,
    ).errors;
    expect(
      errors.some((item) => item.code === "missing-requirement-markdown"),
    ).toBeTruthy();
  });

  it("recognizes ATX headings with up to three leading spaces", () => {
    expect(
      validate(
        validManifest,
        " ## REQ-001 Requirement\n",
        " ## REQ-001 Requirement\n  ### SCN-001 Scenario\n   #### CASE-001 Case\n",
      ).errors,
    ).toEqual([]);
  });

  it("does not treat four-space-indented lines as ATX headings", () => {
    const specification = `${validSpecification}\n    ## REQ-999 Not a heading\n`;
    expect(
      validate(validManifest, validRequirement, specification).errors,
    ).toEqual([]);
  });

  it("preserves # in the complete whitespace-delimited ID token", () => {
    const manifest = validManifest.replaceAll("REQ-001", "REQ-001#draft");
    expect(
      validate(
        manifest,
        "## REQ-001#draft Requirement\n",
        validSpecification.replace("REQ-001", "REQ-001#draft"),
      ).errors,
    ).toEqual([]);
  });

  it("uses hierarchy to disambiguate local IDs shared by every node kind", () => {
    const manifest = validManifest
      .replace("REQ-001", "shared")
      .replace("SCN-001", "shared")
      .replace("CASE-001", "shared");
    const result = validate(
      manifest,
      "# Requirements\n## shared Requirement\n",
      "# Specification\n## shared Requirement\n### shared Scenario\n#### shared Case\n",
    );
    expect(result.errors).toEqual([]);
  });

  it("allows Requirement/Scenario and Scenario/Case ID sharing independently", () => {
    const requirementScenario = validManifest
      .replace("REQ-001", "same-parent")
      .replace("SCN-001", "same-parent");
    expect(
      validate(
        requirementScenario,
        "## same-parent\n",
        "## same-parent\n### same-parent\n#### CASE-001\n",
      ).errors,
    ).toEqual([]);

    const scenarioCase = validManifest
      .replace("SCN-001", "same-child")
      .replace("CASE-001", "same-child");
    expect(
      validate(
        scenarioCase,
        validRequirement,
        "## REQ-001\n### same-child\n#### same-child\n",
      ).errors,
    ).toEqual([]);
  });

  it("detects a Case under the wrong Scenario", () => {
    const wrong = "## REQ-001\n### SCN-OTHER\n#### CASE-001\n### SCN-001\n";
    const found = validate(validManifest, validRequirement, wrong).errors;
    expect(
      found.some((item) => item.code === "missing-specification-case"),
    ).toBeTruthy();
    expect(
      found.some((item) => item.code === "unmanaged-markdown-id"),
    ).toBeTruthy();
  });

  it("detects missing and unmanaged Markdown nodes", () => {
    expect(
      validate(validManifest, "# Requirements", validSpecification).errors.some(
        (item) => item.code === "missing-requirement-markdown",
      ),
    ).toBeTruthy();
    expect(
      validate(
        validManifest,
        `${validRequirement}\n## REQ-999 Extra`,
        validSpecification,
      ).errors.some((item) => item.code === "unmanaged-markdown-id"),
    ).toBeTruthy();
    expect(
      validate(
        validManifest,
        validRequirement,
        "## REQ-001\n### SCN-001",
      ).errors.some((item) => item.code === "missing-specification-case"),
    ).toBeTruthy();
  });

  it(
    mouraEvidenceName(
      "rejects invalid hierarchy and unmanaged IDs through the filesystem boundary",
      ["REQ-001/SCN-001/CASE-004", "REQ-001/SCN-001/CASE-013"],
      "integration",
    ),
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "moura-test-"));
      try {
        await Promise.all([
          writeFile(join(directory, "moura.yaml"), validManifest),
          writeFile(join(directory, "req.md"), validRequirement),
          writeFile(
            join(directory, "spec.md"),
            "## REQ-001\n### SCN-OTHER\n#### CASE-001\n### SCN-001\n",
          ),
        ]);
        const loaded = await loadProjectDirectory(directory);
        expect(loaded.errors.map((item) => item.code)).toEqual(
          expect.arrayContaining([
            "missing-specification-case",
            "unmanaged-markdown-id",
          ]),
        );
      } finally {
        await rm(directory, { recursive: true });
      }
    },
  );

  it("detects every reserved Moura ID prefix in requirement sources", () => {
    for (const id of ["REQ-999", "SCN-999", "CASE-999"]) {
      const errors = validate(
        validManifest,
        `${validRequirement}\n## ${id} Undeclared`,
        validSpecification,
      ).errors;
      expect(
        errors.some(
          (item) =>
            item.code === "unmanaged-markdown-id" && item.message.includes(id),
        ),
        `expected ${id} to be reported as unmanaged`,
      ).toBeTruthy();
    }
  });

  it("does not report declared child IDs as unmanaged in requirement sources", () => {
    const requirement = `${validRequirement}
## SCN-001 Scenario details belong elsewhere
## CASE-001 Case details belong elsewhere`;
    expect(
      validate(validManifest, requirement, validSpecification).errors,
    ).toEqual([]);
  });

  it("does not use a reserved prefix as a manifest node kind", () => {
    const manifest = validManifest
      .replace("REQ-001", "SCN-requirement")
      .replace("SCN-001", "CASE-scenario")
      .replace("CASE-001", "REQ-case");
    expect(
      validate(
        manifest,
        "## SCN-requirement Requirement\n",
        "## SCN-requirement\n### CASE-scenario\n#### REQ-case\n",
      ).errors,
    ).toEqual([]);
  });

  it("does not let child IDs in a requirement source satisfy specification hierarchy", () => {
    const requirement = `${validRequirement}
## SCN-001 Misplaced scenario
### CASE-001 Misplaced case`;
    const errors = validate(
      validManifest,
      requirement,
      "## REQ-001 Requirement only",
    ).errors;
    expect(
      errors.some((item) => item.code === "missing-specification-scenario"),
    ).toBeTruthy();
    expect(
      errors.some((item) => item.code === "missing-specification-case"),
    ).toBeTruthy();
    expect(
      !errors.some((item) => item.code === "unmanaged-markdown-id"),
    ).toBeTruthy();
  });

  it("ignores ordinary undeclared headings in requirement sources", () => {
    expect(
      validate(
        validManifest,
        `${validRequirement}\n## Architecture Notes`,
        validSpecification,
      ).errors,
    ).toEqual([]);
  });

  it("reports invalid heading parentage", () => {
    const errors = validate(
      validManifest,
      validRequirement,
      "## REQ-001\n## SCN-001\n### CASE-001",
    ).errors;
    expect(
      errors.some((item) => item.code === "invalid-markdown-hierarchy"),
    ).toBeTruthy();
  });
});
