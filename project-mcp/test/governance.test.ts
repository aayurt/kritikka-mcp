import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectContext, type ProjectContext } from "../src/config.js";
import type { RulesFile } from "../src/config.js";
import { extractImports, classifyLayer, checkLayerDependency, resolveSpecifier } from "../src/scanner.js";
import { detectSecrets, redact } from "../src/secrets.js";
import { findRuleMatches, findAdrRequirement, findTestRequirement } from "../src/impact.js";
import { validateArchitecture, detectSecretsTool, inspectTask, analyzeImpact } from "../src/tools/governance-tools.js";

function miniRepo(files: Record<string, string>, rules: RulesFile): ProjectContext {
  const root = mkdtempSync(join(tmpdir(), "pmc-gov-"));
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  writeFileSync(join(root, "mcp-rules.json"), JSON.stringify(rules));
  writeFileSync(
    join(root, "docs/adr/0001-core.md"),
    '---\nid: "0001"\ntitle: "Core"\nstatus: accepted\n---\n\n# ADR-0001: Core\n',
  );
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return loadProjectContext(root);
}

function cleanup(ctx: ProjectContext): void {
  rmSync(ctx.projectRoot, { recursive: true, force: true });
}

const LAYER_RULE: RulesFile = {
  version: 1,
  rules: [
    {
      type: "layerDependency",
      id: "layered",
      layers: [
        { name: "ui", globs: ["src/ui/**"] },
        { name: "app", globs: ["src/app/**"] },
        { name: "domain", globs: ["src/domain/**"] },
      ],
      direction: "inward-only",
      reason: "Inward only.",
      severity: "error",
    },
  ],
};

describe("extractImports", () => {
  it("extracts plain, type, re-export, and dynamic imports", () => {
    const src = [
      "import { a } from './a';",
      "import type { T } from \"../types\";",
      "export { b } from './b';",
      "const c = await import('./c');",
      "import './side-effect';",
    ].join("\n");
    expect(extractImports(src)).toEqual(["./a", "../types", "./b", "./c", "./side-effect"]);
  });

  it("ignores non-import lines", () => {
    expect(extractImports("const x = 1;\n// import fake from './fake'")).toEqual([]);
  });
});

describe("resolveSpecifier", () => {
  it("resolves extensionless relative imports to .ts files", () => {
    const ctx = miniRepo(
      {
        "src/app/main.ts": "import { x } from '../domain/core';\n",
        "src/domain/core.ts": "export const x = 1;\n",
      },
      LAYER_RULE,
    );
    try {
      expect(resolveSpecifier(ctx.projectRoot, "src/app/main.ts", "../domain/core")).toBe("src/domain/core.ts");
    } finally {
      cleanup(ctx);
    }
  });

  it("returns undefined for bare and node: specifiers", () => {
    expect(resolveSpecifier("/nonexistent", "a/b.ts", "picomatch")).toBeUndefined();
    expect(resolveSpecifier("/nonexistent", "a/b.ts", "node:fs")).toBeUndefined();
  });
});

describe("classifyLayer", () => {
  it("classifies by first matching layer, outermost wins", () => {
    const layers = LAYER_RULE.rules[0]!.type === "layerDependency" ? LAYER_RULE.rules[0]!.layers : [];
    expect(classifyLayer("src/ui/button.ts", layers)).toBe(0);
    expect(classifyLayer("src/domain/model.ts", layers)).toBe(2);
    expect(classifyLayer("src/other.ts", layers)).toBeUndefined();
  });
});

describe("checkLayerDependency", () => {
  it("flags domain importing ui as an outward violation with both layer names", () => {
    const ctx = miniRepo(
      {
        "src/domain/model.ts": "import { Button } from '../ui/button';\nexport const m = 1;\n",
        "src/ui/button.ts": "export const Button = 1;\n",
        "src/app/service.ts": "import { m } from '../domain/model';\n",
      },
      LAYER_RULE,
    );
    try {
      const result = checkLayerDependency(ctx, {
        id: "layered",
        layers: LAYER_RULE.rules[0]!.type === "layerDependency" ? LAYER_RULE.rules[0]!.layers : [],
        severity: "error",
      });
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatchObject({
        file: "src/domain/model.ts",
        fromLayer: "domain",
        toLayer: "ui",
      });
      expect(result.findings[0]?.severity).toBe("error");
    } finally {
      cleanup(ctx);
    }
  });

  it("allows inward imports (ui -> app -> domain) and files outside all layers", () => {
    const ctx = miniRepo(
      {
        "src/ui/page.ts": "import { s } from '../app/service';\n",
        "src/app/service.ts": "import { m } from '../domain/model';\n",
        "src/domain/model.ts": "export const m = 1;\n",
        "scripts/loose.js": "import { m } from '../src/domain/model';\n",
      },
      LAYER_RULE,
    );
    try {
      const result = checkLayerDependency(ctx, {
        id: "layered",
        layers: LAYER_RULE.rules[0]!.type === "layerDependency" ? LAYER_RULE.rules[0]!.layers : [],
        severity: "error",
      });
      expect(result.violations).toHaveLength(0);
      expect(result.checkedFiles).toBeGreaterThan(0);
    } finally {
      cleanup(ctx);
    }
  });
});

describe("secret scanning", () => {
  it("redacts evidence", () => {
    const line = "API_KEY = 'super-secret-value-1234567890'";
    const out = redact(line);
    expect(out).not.toContain("super-secret");
    expect(out).toContain("…");
  });

  it("finds private keys and credential URLs as errors, generic assignments as warnings", () => {
    const ctx = miniRepo(
      {
        "certs/key.pem": "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\n",
        "config/db.ts": "export const url = 'postgres://admin:hunter2@db.example.com:5432/app';\n",
        "config/opts.ts": "const api_key = 'some-random-long-value-1';\n",
      },
      { version: 1, rules: [] },
    );
    try {
      const result = detectSecrets(ctx);
      const ids = result.findings.map((f) => f.ruleId);
      expect(ids).toContain("secret:private-key-block");
      expect(ids).toContain("secret:database-url-with-credentials");
      expect(ids).toContain("secret:generic-api-key-assignment");
      expect(result.findings.find((f) => f.ruleId === "secret:private-key-block")?.severity).toBe("error");
      expect(result.findings.find((f) => f.ruleId === "secret:generic-api-key-assignment")?.severity).toBe("warning");
    } finally {
      cleanup(ctx);
    }
  });

  it("skips node_modules and honors the tool surface", () => {
    const ctx = miniRepo(
      {
        "node_modules/pkg/index.js": "const token = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';\n",
        "src/clean.ts": "export const clean = 1;\n",
      },
      { version: 1, rules: [] },
    );
    try {
      const tool = detectSecretsTool(ctx);
      expect(tool.clean).toBe(true);
      expect(tool.violations).toHaveLength(0);
    } finally {
      cleanup(ctx);
    }
  });
});

describe("impact helpers", () => {
  const RULES: RulesFile = {
    version: 1,
    rules: [
      { type: "forbidden", id: "no-dist", match: ["dist/**"], reason: "Build output.", severity: "error" },
      {
        type: "requireAdr",
        id: "records-governed",
        match: ["src/records/**"],
        adr: "0001",
        reason: "Governed.",
        severity: "error",
      },
      {
        type: "requireTest",
        id: "src-tests",
        match: ["src/**/*.ts"],
        testMatch: ["**/*.test.ts"],
        testExempt: ["**/*.d.ts"],
        reason: "Tests.",
        severity: "error",
      },
    ],
  };

  it("findRuleMatches returns rules covering the candidate paths", () => {
    const ctx = miniRepo({}, RULES);
    try {
      const matches = findRuleMatches(ctx, ["src/records/store.ts", "dist/x.js"]);
      expect(matches.map((m) => m.rule.id).sort()).toEqual(["no-dist", "records-governed", "src-tests"]);
    } finally {
      cleanup(ctx);
    }
  });

  it("findAdrRequirement returns the first requirement with its paths", () => {
    const ctx = miniRepo({}, RULES);
    try {
      expect(findAdrRequirement(ctx, ["src/records/a.ts", "src/free/b.ts"])).toMatchObject({
        adr: "0001",
        paths: ["src/records/a.ts"],
      });
      expect(findAdrRequirement(ctx, ["src/free/b.ts"])).toBeUndefined();
    } finally {
      cleanup(ctx);
    }
  });

  it("findTestRequirement unions matching rules and honors exemptions", () => {
    const ctx = miniRepo({}, RULES);
    try {
      expect(findTestRequirement(ctx, ["src/a.ts", "src/types.d.ts"])).toMatchObject({
        ruleIds: ["src-tests"],
        paths: ["src/a.ts"],
      });
      expect(findTestRequirement(ctx, ["docs/x.md"])).toBeUndefined();
    } finally {
      cleanup(ctx);
    }
  });
});

describe("governance tools", () => {
  it("validate_architecture reports valid on a clean layered repo", () => {
    const ctx = miniRepo(
      {
        "src/ui/page.ts": "import { s } from '../app/service';\n",
        "src/app/service.ts": "import { m } from '../domain/model';\n",
        "src/domain/model.ts": "export const m = 1;\n",
      },
      LAYER_RULE,
    );
    try {
      const result = validateArchitecture(ctx);
      expect(result.valid).toBe(true);
      expect(result.rulesChecked).toBe(1);
      expect(result.checkedImports).toBeGreaterThan(0);
    } finally {
      cleanup(ctx);
    }
  });

  it("inspect_task surfaces matched rules, ADR requirement, and test requirement", () => {
    const ctx = miniRepo({}, {
      version: 1,
      rules: [
        { type: "requireAdr", id: "records-governed", match: ["src/records/**"], adr: "0001", reason: "r", severity: "error" },
        { type: "requireTest", id: "src-tests", match: ["src/**/*.ts"], testMatch: ["**/*.test.ts"], testExempt: [], reason: "r", severity: "error" },
      ],
    });
    try {
      const out = inspectTask(ctx, { description: "Add a record export", files: ["src/records/store.ts"] });
      expect(out.matchedRules.map((m) => m.ruleId).sort()).toEqual(["records-governed", "src-tests"]);
      expect(out.adrRequirement?.adr).toBe("0001");
      expect(out.relevantAdrs[0]?.status).toBe("accepted");
      expect(out.testRequirement?.testMatch).toContain("**/*.test.ts");
    } finally {
      cleanup(ctx);
    }
  });

  it("analyze_impact names layers touched and gives guidance", () => {
    const ctx = miniRepo({}, LAYER_RULE);
    try {
      const out = analyzeImpact(ctx, { files: ["src/domain/model.ts"] });
      expect(out.layersTouched).toContain("domain");
      expect(out.guidance).toContain("validate_change");
    } finally {
      cleanup(ctx);
    }
  });
});
