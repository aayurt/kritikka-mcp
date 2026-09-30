import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectContext, type ProjectContext } from "../src/config.js";
import {
  signatureView,
  sectionExtract,
  jsonKeysView,
  testNamesView,
  compressContext,
} from "../src/compress.js";
import type { ContextItem } from "../src/context.js";

function repo(files: Record<string, string>): ProjectContext {
  const root = mkdtempSync(join(tmpdir(), "pmc-compress-"));
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  writeFileSync(join(root, "mcp-rules.json"), JSON.stringify({ version: 1, rules: [] }));
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return loadProjectContext(root);
}

describe("condensation views", () => {
  it("signatureView keeps imports and exported declarations, drops bodies", () => {
    const src = [
      "import { x } from './x';",
      "export function alpha(a: string): string {",
      "  return a + x;",
      "}",
      "const hidden = 1;",
      "export interface Shape { size: number }",
    ].join("\n");
    const view = signatureView(src);
    expect(view).toContain("import { x }");
    expect(view).toContain("export function alpha");
    expect(view).toContain("export interface Shape");
    expect(view).not.toContain("return a + x");
    expect(view).not.toContain("const hidden");
  });

  it("sectionExtract ranks keyword-matching sections first and keeps heading + paragraph", () => {
    const doc = [
      "# Deploy",
      "",
      "Deploy via rsync to the VPS.",
      "",
      "# Unrelated",
      "",
      "Nothing here.",
      "",
      "# Rollback",
      "",
      "Redeploy the previous known-good build.",
    ].join("\n");
    const out = sectionExtract(doc, ["rollback"]);
    expect(out.indexOf("Rollback")).toBeLessThan(out.indexOf("Deploy"));
    expect(out).toContain("Redeploy the previous");
  });

  it("jsonKeysView lists top-level keys", () => {
    expect(jsonKeysView('{"version":1,"rules":[1,2]}')).toContain("version");
    expect(jsonKeysView("{ broken")).toContain("unparseable");
  });

  it("testNamesView lists case names", () => {
    const out = testNamesView("it('parses accepted', () => {});\nit(\"handles missing\", fn);");
    expect(out).toContain("- parses accepted");
    expect(out).toContain("- handles missing");
  });
});

describe("compressContext", () => {
  const FILES: Record<string, string> = {
    "big.ts": `import { a } from './a';\nexport function one() {\n${Array.from({ length: 80 }, (_, i) => `  // line ${i}`).join("\n")}\n}\nexport const two = 2;\n`,
    "doc.md": "# A\n\nAlpha paragraph.\n\n# B\n\nBeta paragraph.\n",
    "cfg.json": '{"version":1,"rules":[]}',
    "small.test.ts": "it('works', () => {});\n",
  };

  it("condenses oversized files and keeps small ones verbatim", () => {
    const ctx = repo(FILES);
    try {
      const items: ContextItem[] = [
        { path: "big.ts", why: "target", lines: 85 },
        { path: "doc.md", why: "governs", lines: 8 },
        { path: "cfg.json", why: "rules", lines: 1 },
        { path: "small.test.ts", why: "tests", lines: 1 },
      ];
      const result = compressContext(ctx, items, { budgetLines: 60 });
      const byPath = new Map(result.items.map((i) => [i.path, i]));
      expect(byPath.get("big.ts")?.strategy).toBe("signatures");
      expect(byPath.get("big.ts")?.excerpt).toContain("export function one");
      expect(byPath.get("big.ts")?.excerpt).not.toContain("// line 40");
      // small files fit the budget and stay verbatim by design
      expect(byPath.get("doc.md")?.strategy).toBe("verbatim");
      expect(byPath.get("small.test.ts")?.strategy).toBe("verbatim");
      expect(result.compressedLines).toBeLessThan(result.originalLines);
      expect(result.ratio).toBeLessThan(1);
    } finally {
      rmSync(ctx.projectRoot, { recursive: true, force: true });
    }
  });

  it("respects the budget: compressed output stays near budgetLines", () => {
    const ctx = repo(FILES);
    try {
      const items: ContextItem[] = [
        { path: "big.ts", why: "target", lines: 85 },
        { path: "doc.md", why: "governs", lines: 8 },
        { path: "cfg.json", why: "rules", lines: 1 },
      ];
      const result = compressContext(ctx, items, { budgetLines: 30 });
      expect(result.compressedLines).toBeLessThanOrEqual(30 * 1.25 + 1);
    } finally {
      rmSync(ctx.projectRoot, { recursive: true, force: true });
    }
  });

  it("applies kind strategies once the budget forces condensation", () => {
    const sections = Array.from({ length: 6 }, (_, i) => `# Section ${i}\n\nParagraph ${i} text.\n`).join("\n");
    const keys = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`key${i}`, i]));
    const tests = Array.from({ length: 12 }, (_, i) => `it('case ${i}', () => {});`).join("\n");
    const ctx = repo({
      "doc.md": sections,
      "cfg.json": JSON.stringify(keys, null, 1),
      "a.test.ts": tests,
      "code.ts": `export function one() {\n${Array.from({ length: 25 }, (_, i) => `  // ${i}`).join("\n")}\n}\nexport const two = 2;\n`,
    });
    try {
      const items: ContextItem[] = [
        { path: "code.ts", why: "target", lines: 28 },
        { path: "doc.md", why: "governs", lines: 24 },
        { path: "cfg.json", why: "rules", lines: 20 },
        { path: "a.test.ts", why: "tests", lines: 12 },
      ];
      const result = compressContext(ctx, items, { budgetLines: 25 });
      const byPath = new Map(result.items.map((i) => [i.path, i]));
      expect(byPath.get("a.test.ts")?.strategy).toBe("verbatim");
      expect(byPath.get("cfg.json")?.strategy).toBe("json-keys");
      expect(byPath.get("doc.md")?.strategy).toBe("sections");
      expect(byPath.get("code.ts")?.strategy).toBe("signatures");
      expect(byPath.get("doc.md")?.excerpt).toContain("# Section");
      expect(result.compressedLines).toBeLessThanOrEqual(25 * 1.25 + 1);
    } finally {
      rmSync(ctx.projectRoot, { recursive: true, force: true });
    }
  });

  it("handles missing files without throwing", () => {
    const ctx = repo(FILES);
    try {
      const result = compressContext(ctx, [{ path: "ghost.ts", why: "gone", lines: 10 }], {});
      expect(result.items).toHaveLength(0);
      expect(result.originalLines).toBe(0);
      expect(result.ratio).toBe(1);
    } finally {
      rmSync(ctx.projectRoot, { recursive: true, force: true });
    }
  });
});
