import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectContext, type ProjectContext } from "../src/config.js";
import type { RulesFile } from "../src/config.js";
import { buildRelevantContext, taskKeywords } from "../src/context.js";

function repo(files: Record<string, string>, rules: RulesFile): ProjectContext {
  const root = mkdtempSync(join(tmpdir(), "pmc-context-"));
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  writeFileSync(join(root, "mcp-rules.json"), JSON.stringify(rules));
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

const RULES: RulesFile = {
  version: 1,
  rules: [
    {
      type: "requireAdr",
      id: "records-governed",
      match: ["src/records/**"],
      adr: "0001",
      reason: "Governed by the storage engine ADR.",
      severity: "error",
    },
    {
      type: "requireTest",
      id: "src-tests",
      match: ["src/**/*.ts"],
      testMatch: ["**/*.test.ts"],
      testExempt: [],
      reason: "Ship tests.",
      severity: "error",
    },
    {
      type: "requireDocUpdate",
      id: "docs-stale",
      match: ["src/records/**"],
      docs: ["docs/ARCHITECTURE.md"],
      reason: "Keep architecture current.",
      severity: "warning",
    },
  ],
};

const FILES: Record<string, string> = {
  "README.md": "# T\n",
  "docs/ARCHITECTURE.md": "# Architecture\n",
  "docs/adr/0001-storage.md": '---\nid: "0001"\ntitle: "Record storage engine"\nstatus: accepted\n---\n\n# ADR-0001: Record storage engine\n',
  "docs/adr/0002-queues.md": '---\nid: "0002"\ntitle: "Isolate background queues"\nstatus: proposed\n---\n\n# ADR-0002: Isolate background queues\n',
  "src/records/store.ts": "export const store = 1;\n",
  "src/records/store.test.ts": "import { store } from './store';\n",
  "src/records/neighbor.ts": "export const neighbor = 1;\n",
  "src/free/loose.ts": "export const loose = 1;\n",
};

describe("taskKeywords", () => {
  it("extracts meaningful lowercase stems, dropping stopwords", () => {
    expect(taskKeywords("Add record export to the store")).toEqual(["record", "export", "store"]);
  });

  it("deduplicates case-insensitively", () => {
    expect(taskKeywords("Queue queue QUEUE")).toEqual(["queue"]);
  });
});

describe("buildRelevantContext", () => {
  it("bundles governing contracts, required ADR, targets, neighbors, and tests", () => {
    const ctx = repo(FILES, RULES);
    try {
      const out = buildRelevantContext(ctx, {
        description: "Add record export to the store",
        files: ["src/records/store.ts"],
      });
      expect(out.contracts.map((c) => c.path)).toContain("mcp-rules.json");
      expect(out.contracts.map((c) => c.path)).toContain("docs/ARCHITECTURE.md");
      expect(out.adrs[0]).toMatchObject({ path: "docs/adr/0001-storage.md" });
      expect(out.adrs[0]?.why).toContain("accepted");
      expect(out.code.map((c) => c.path)).toContain("src/records/store.ts");
      expect(out.code.map((c) => c.path)).toContain("src/records/neighbor.ts");
      expect(out.code.map((c) => c.path)).not.toContain("src/free/loose.ts");
      expect(out.tests.map((t) => t.path)).toContain("src/records/store.test.ts");
      expect(out.guidance.join(" ")).toContain("validate_change");
      expect(out.guidance.join(" ")).toContain("ADR-0001");
      expect(out.estimatedLines).toBeGreaterThan(0);
      for (const section of [out.contracts, out.adrs, out.code, out.tests]) {
        for (const i of section) expect(i.lines).toBeGreaterThan(0);
      }
    } finally {
      cleanup(ctx);
    }
  });

  it("keyword-matches ADR titles when no rule requires one", () => {
    const ctx = repo(FILES, {
      version: 1,
      rules: [
        {
          type: "requireAdr",
          id: "queues-governed",
          match: ["src/queues/**"],
          adr: "0002",
          reason: "Governed by the queues ADR.",
          severity: "error",
        },
      ],
    });
    try {
      const out = buildRelevantContext(ctx, {
        description: "Isolate background queue retries",
        files: ["src/free/loose.ts"],
      });
      expect(out.adrs.map((a) => a.path)).toContain("docs/adr/0002-queues.md");
      expect(out.adrs.map((a) => a.path)).not.toContain("docs/adr/0001-storage.md");
    } finally {
      cleanup(ctx);
    }
  });

  it("returns an empty-but-structured bundle for unknown paths", () => {
    const ctx = repo(FILES, RULES);
    try {
      const out = buildRelevantContext(ctx, {
        description: "Touch nothing real",
        files: ["src/nowhere/void.ts"],
      });
      expect(out.adrs).toEqual([]);
      expect(out.contracts.length).toBeGreaterThan(0); // machine rules still govern
      expect(out.guidance.join(" ")).toContain("validate_change");
    } finally {
      cleanup(ctx);
    }
  });
});
