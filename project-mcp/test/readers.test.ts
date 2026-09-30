import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRules, RulesValidationError, resolveProjectRoot, safeRead } from "../src/config.js";
import type { RulesFile } from "../src/config.js";
import { listAdrs, listAdrFiles, parseAdr, parseAdrStatus, parseAdrTitle, readDoc } from "../src/readers.js";
import { fixtureContext, makeFixtureRepo, removeFixtureRepo } from "./helpers.js";

describe("ADR status parsing", () => {
  it("parses accepted", () => {
    expect(parseAdrStatus('---\nid: "0001"\nstatus: accepted\ndate: 2026-01-01\n---\n\n# ADR-0001: X')).toBe("accepted");
  });

  it("parses proposed", () => {
    expect(parseAdrStatus("---\nstatus: proposed\n---\nbody")).toBe("proposed");
  });

  it("parses superseded", () => {
    expect(parseAdrStatus("---\nstatus: superseded\n---\nbody")).toBe("superseded");
  });

  it("is case-insensitive and strips quotes", () => {
    expect(parseAdrStatus("---\nstatus: 'Accepted'\n---\nbody")).toBe("accepted");
  });

  it("returns unknown without frontmatter", () => {
    expect(parseAdrStatus("# just a title\nbody")).toBe("unknown");
  });

  it("returns unknown when the status field is missing", () => {
    expect(parseAdrStatus("---\nid: \"0009\"\n---\nbody")).toBe("unknown");
  });

  it("returns unknown for unrecognized status values", () => {
    expect(parseAdrStatus("---\nstatus: maybe\n---\nbody")).toBe("unknown");
  });

  it("finds the H1 title", () => {
    expect(parseAdrTitle("# ADR-0001: Record storage engine\n")).toBe("Record storage engine");
  });

  it("returns undefined title when the H1 pattern does not match", () => {
    expect(parseAdrTitle("# Not An ADR Heading\n")).toBeUndefined();
  });
});

describe("ADR listing", () => {
  it("lists fixture ADRs in id order with parsed statuses", () => {
    const root = makeFixtureRepo();
    try {
      const adrs = listAdrs(root);
      expect(adrs.map((a) => `${a.id}:${a.status}`)).toEqual([
        "0000:template",
        "0001:accepted",
        "0002:proposed",
      ]);
      expect(adrs[1]?.title).toBe("Record storage engine");
      expect(adrs[1]?.file).toBe("docs/adr/0001-record-storage-engine.md");
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("falls back to the filename for id and title when frontmatter is sparse", () => {
    const root = makeFixtureRepo({
      files: {
        "docs/adr/0007-fallback-id.md": "---\nstatus: accepted\n---\n\n# ADR-0007: Fallback title\n",
      },
    });
    try {
      const parsed = parseAdr(root, "docs/adr/0007-fallback-id.md");
      if (!("status" in parsed)) throw new Error("expected parsed ADR");
      expect(parsed.id).toBe("0007");
      expect(parsed.title).toBe("Fallback title");
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("listAdrFiles ignores non-ADR files and sorts numerically", () => {
    const root = makeFixtureRepo({
      files: {
        "docs/adr/notes.txt": "not an adr",
        "docs/adr/9999-z.md": "---\nstatus: proposed\n---\n",
      },
    });
    try {
      const files = listAdrFiles(root);
      expect(files[0]).toBe("docs/adr/0000-template.md");
      expect(files).toContain("docs/adr/9999-z.md");
      expect(files.every((f) => f.endsWith(".md"))).toBe(true);
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("returns an empty list when docs/adr is absent", () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-empty-"));
    try {
      expect(listAdrFiles(root)).toEqual([]);
      expect(listAdrs(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("doc reads", () => {
  it("readDoc returns found:true with content for present docs", () => {
    const root = makeFixtureRepo();
    try {
      const read = readDoc(root, "docs/ARCHITECTURE.md");
      expect(read.found).toBe(true);
      if (read.found) expect(read.content).toMatch(/^# Architecture/);
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("readDoc returns a structured miss with hint for absent docs", () => {
    const root = makeFixtureRepo();
    try {
      const read = readDoc(root, "docs/NOPE.md");
      expect(read.found).toBe(false);
      if (!read.found) {
        expect(read.hint).toContain("docs/NOPE.md");
        expect(read.hint).toContain("--root");
      }
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("safeRead rejects traversal without touching the filesystem", () => {
    const root = makeFixtureRepo();
    try {
      const read = safeRead(root, "../../../etc/hosts");
      expect(read.found).toBe(false);
      if (!read.found) expect(read.hint).toMatch(/escapes the repository/);
    } finally {
      removeFixtureRepo(root);
    }
  });
});

describe("rules loading", () => {
  it("loads and validates the fixture rules", () => {
    const root = makeFixtureRepo();
    try {
      const rules = loadRules(root);
      expect(rules.rules).toHaveLength(4);
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("throws RulesValidationError with issues for unknown rule types", () => {
    const root = makeFixtureRepo({
      rules: { version: 1, rules: [{ type: "mystery", id: "x", match: ["a"], reason: "r" }] } as never,
    });
    try {
      expect(() => loadRules(root)).toThrow(RulesValidationError);
      try {
        loadRules(root);
      } catch (error) {
        expect((error as RulesValidationError).issues.join("\n")).toMatch(/Invalid discriminator value/i);
      }
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("throws RulesValidationError for duplicate rule ids", () => {
    const dup = {
      type: "forbidden",
      id: "same",
      match: ["a/**"],
      reason: "r",
      severity: "error",
    } as RulesFile["rules"][number];
    const root = makeFixtureRepo({
      rules: { version: 1, rules: [dup, { ...dup, match: ["b/**"] } as typeof dup] },
    });
    try {
      expect(() => loadRules(root)).toThrow(/Duplicate rule id: same/);
    } finally {
      removeFixtureRepo(root);
    }
  });

  it("throws RulesValidationError for a missing rules file", () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-norules-"));
    try {
      expect(() => loadRules(root)).toThrow(/mcp-rules.json not found/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws RulesValidationError for malformed JSON", () => {
    const root = mkdtempSync(join(tmpdir(), "project-mcp-badjson-"));
    writeFileSync(join(root, "mcp-rules.json"), "{ not json");
    try {
      expect(() => loadRules(root)).toThrow(/not valid JSON/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws RulesValidationError for the wrong version", () => {
    const root = makeFixtureRepo({
      rules: { version: 2, rules: [] } as never,
    });
    try {
      expect(() => loadRules(root)).toThrow(RulesValidationError);
    } finally {
      removeFixtureRepo(root);
    }
  });
});

describe("root resolution", () => {
  it("prefers the explicit argument over env and cwd", () => {
    const root = makeFixtureRepo();
    try {
      process.env.PROJECT_MCP_ROOT = "/env/root";
      const prevArgv = process.argv;
      process.argv = ["node", "index.js", "unrelated"];
      try {
        expect(resolveProjectRoot(join(root, "subdir"))).toBe(join(root, "subdir"));
      } finally {
        process.argv = prevArgv;
      }
    } finally {
      delete process.env.PROJECT_MCP_ROOT;
      removeFixtureRepo(root);
    }
  });

  it("falls back to PROJECT_MCP_ROOT when no arg is given", () => {
    const root = makeFixtureRepo();
    try {
      process.env.PROJECT_MCP_ROOT = root;
      const prevArgv = process.argv;
      process.argv = ["node", "index.js"];
      try {
        expect(resolveProjectRoot()).toBe(root);
      } finally {
        process.argv = prevArgv;
      }
    } finally {
      delete process.env.PROJECT_MCP_ROOT;
      removeFixtureRepo(root);
    }
  });

  it("falls back to cwd when neither arg nor env is set", () => {
    delete process.env.PROJECT_MCP_ROOT;
    const prevArgv = process.argv;
    process.argv = ["node", "index.js"];
    try {
      expect(resolveProjectRoot()).toBe(process.cwd());
    } finally {
      process.argv = prevArgv;
    }
  });
});
