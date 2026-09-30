import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectContext, type ProjectContext } from "../src/config.js";
import { findExistingPattern } from "../src/patterns.js";
import { findExistingPatternTool } from "../src/tools/find-pattern.js";

function repo(files: Record<string, string>): ProjectContext {
  const root = mkdtempSync(join(tmpdir(), "pmc-patterns-"));
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  writeFileSync(join(root, "mcp-rules.json"), JSON.stringify({ version: 1, rules: [] }));
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

const PAGINATION_FILES: Record<string, string> = {
  // The established pattern: imported by two modules, covered by tests
  "src/shared/pagination.ts":
    "export interface Page { items: string[]; cursor: string }\nexport function paginate(): void {}\n",
  "src/users/list.ts": "import { paginate } from '../shared/pagination';\nexport const listUsers = paginate;\n",
  "src/events/list.ts": "import { paginate } from '../shared/pagination';\nexport const listEvents = paginate;\n",
  "src/shared/pagination.test.ts":
    "import { paginate } from './pagination';\nit('paginates', () => {});\n",
  // A rival one-off with no usage
  "src/admin/offset-page.ts": "export function offsetPage(): void {}\n",
};

describe("findExistingPattern", () => {
  it("ranks the imported, tested implementation first and recommends it with high confidence", () => {
    const ctx = repo(PAGINATION_FILES);
    try {
      const report = findExistingPattern(ctx, "pagination");
      expect(report.candidates[0]?.file).toBe("src/shared/pagination.ts");
      expect(report.candidates[0]?.importers).toBe(2);
      expect(report.candidates[0]?.coveredByTests).toContain("src/shared/pagination.test.ts");
      expect(report.candidates[0]?.matchedIn).toContain("filename");
      expect(report.recommendation).toMatchObject({
        file: "src/shared/pagination.ts",
        confidence: "high",
      });
      expect(report.recommendation?.reason).toContain("2 internal module");
      expect(report.guidance[0]).toContain("Copy");
    } finally {
      cleanup(ctx);
    }
  });

  it("matches exports, not just file names", () => {
    const ctx = repo({
      "src/core/scroll.ts": "export function paginateRecords(): void {}\n",
    });
    try {
      const report = findExistingPattern(ctx, "pagination");
      expect(report.candidates[0]?.file).toBe("src/core/scroll.ts");
      expect(report.candidates[0]?.matchedIn).toContain("exports");
      expect(report.recommendation?.confidence).toBe("low");
    } finally {
      cleanup(ctx);
    }
  });

  it("returns an empty report with create-new guidance when nothing matches", () => {
    const ctx = repo({ "src/free/x.ts": "export const x = 1;\n" });
    try {
      const report = findExistingPattern(ctx, "graphql-resolvers");
      expect(report.candidates).toHaveLength(0);
      expect(report.recommendation).toBeUndefined();
      expect(report.guidance.join(" ")).toContain("No established pattern");
    } finally {
      cleanup(ctx);
    }
  });

  it("tool surface parses and forwards input", () => {
    const ctx = repo(PAGINATION_FILES);
    try {
      const out = findExistingPatternTool(ctx, { concept: "pagination", limit: 1 });
      expect(out.candidates.length).toBeLessThanOrEqual(1);
      expect(out.recommendation?.file).toBe("src/shared/pagination.ts");
    } finally {
      cleanup(ctx);
    }
  });
});
