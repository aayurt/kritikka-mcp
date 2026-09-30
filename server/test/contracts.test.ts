import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectContext, type ProjectContext } from "../src/config.js";
import type { RulesFile } from "../src/config.js";
import { parseAdr, parseAdrStatus } from "../src/readers.js";
import { buildConstraintView, discoverContracts, validateContracts } from "../src/contracts.js";
import { getConstraints, validateContractsTool } from "../src/tools/contracts-tools.js";

function repo(files: Record<string, string>, rules: RulesFile): ProjectContext {
  const root = mkdtempSync(join(tmpdir(), "pmc-contracts-"));
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

const MIN_RULES: RulesFile = { version: 1, rules: [] };

const BASE_DOCS: Record<string, string> = {
  "README.md": "# T\n",
  "docs/ARCHITECTURE.md": "# Architecture\nLayers: ui, app, domain.\n",
};

describe("supersedes parsing", () => {
  it("parses frontmatter supersedes lists", () => {
    expect(
      parseAdrStatus('---\nid: "0002"\nstatus: accepted\nsupersedes: "0001"\n---\nbody'),
    ).toBe("accepted");
  });

  it("extracts supersedes from frontmatter into ParsedAdr", () => {
    const root = mkdtempSync(join(tmpdir(), "pmc-super-"));
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    writeFileSync(
      join(root, "docs/adr/0002-new-way.md"),
      '---\nid: "0002"\nstatus: accepted\nsupersedes: "0001, 0000"\n---\n\n# ADR-0002: New way\n',
    );
    try {
      const parsed = parseAdr(root, "docs/adr/0002-new-way.md");
      if (!("status" in parsed)) throw new Error("expected parsed");
      expect(parsed.supersedes.sort()).toEqual(["0000", "0001"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back to the body: 'Supersedes ADR-0001.'", () => {
    const root = mkdtempSync(join(tmpdir(), "pmc-super2-"));
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    writeFileSync(
      join(root, "docs/adr/0003-x.md"),
      '---\nid: "0003"\nstatus: accepted\n---\n\n# ADR-0003: X\n\nSupersedes ADR-0001.\n',
    );
    try {
      const parsed = parseAdr(root, "docs/adr/0003-x.md");
      if (!("status" in parsed)) throw new Error("expected parsed");
      expect(parsed.supersedes).toEqual(["0001"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns empty when nothing is superseded", () => {
    const root = mkdtempSync(join(tmpdir(), "pmc-super3-"));
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    writeFileSync(
      join(root, "docs/adr/0001-a.md"),
      '---\nid: "0001"\nstatus: accepted\n---\n\n# ADR-0001: A\n',
    );
    try {
      const parsed = parseAdr(root, "docs/adr/0001-a.md");
      if (!("status" in parsed)) throw new Error("expected parsed");
      expect(parsed.supersedes).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("discoverContracts", () => {
  it("lists well-known docs with presence and discovers extras in docs/", () => {
    const ctx = repo(
      { ...BASE_DOCS, "docs/CONTRACTS.md": "# Contracts\n", "docs/adr/0001-a.md": '---\nid: "0001"\nstatus: accepted\n---\n# ADR-0001: A\n' },
      MIN_RULES,
    );
    try {
      const docs = discoverContracts(ctx);
      const paths = docs.map((d) => d.path);
      expect(paths).toContain("docs/CONTRACTS.md");
      expect(paths).toContain("docs/adr");
      expect(paths).not.toContain("docs/NOPE.md");
      const arch = docs.find((d) => d.path === "docs/ARCHITECTURE.md");
      expect(arch).toMatchObject({ present: true, source: "docs-dir" });
      const missing = docs.find((d) => d.path === "AGENTS.md");
      expect(missing).toMatchObject({ present: false, source: "root-doc" });
    } finally {
      cleanup(ctx);
    }
  });
});

describe("buildConstraintView (get_constraints)", () => {
  it("compiles every rule type into one view with ADR statuses", () => {
    const ctx = repo(
      {
        ...BASE_DOCS,
        "docs/adr/0001-core.md": '---\nid: "0001"\nstatus: accepted\n---\n# ADR-0001: Core\n',
      },
      {
        version: 1,
        rules: [
          { type: "forbidden", id: "f", match: ["dist/**"], reason: "build", severity: "error" },
          { type: "requireAdr", id: "ra", match: ["src/records/**"], adr: "0001", reason: "governed", severity: "error" },
          { type: "requireTest", id: "rt", match: ["src/**/*.ts"], testMatch: ["**/*.test.ts"], testExempt: [], reason: "tests", severity: "error" },
          { type: "requireDocUpdate", id: "rd", match: ["src/records/**"], docs: ["docs/ARCHITECTURE.md"], reason: "docs", severity: "warning" },
          {
            type: "layerDependency",
            id: "layers",
            layers: [
              { name: "ui", globs: ["src/ui/**"] },
              { name: "domain", globs: ["src/domain/**"] },
            ],
            direction: "inward-only",
            reason: "inward",
            severity: "error",
          },
        ],
      },
    );
    try {
      const view = getConstraints(ctx);
      expect(view.rules.forbidden.map((r) => r.id)).toEqual(["f"]);
      expect(view.rules.adrRequirements[0]).toMatchObject({ adr: "0001", adrStatus: "accepted" });
      expect(view.rules.testRequirements[0]?.testMatch).toEqual(["**/*.test.ts"]);
      expect(view.rules.layerPolicies[0]?.layers.map((l) => l.name)).toEqual(["ui", "domain"]);
      expect(view.adrIndex[0]).toMatchObject({ id: "0001", status: "accepted" });
      expect(view.agentGuidance.length).toBeGreaterThan(0);
      expect(view.docIndex.some((d) => d.role === "machine-rules" && d.present)).toBe(true);
    } finally {
      cleanup(ctx);
    }
  });

  it("reports adrStatus 'missing' for requirements pointing nowhere", () => {
    const ctx = repo(
      { ...BASE_DOCS, "docs/adr/0001-core.md": '---\nid: "0001"\nstatus: accepted\n---\n# ADR-0001\n' },
      {
        version: 1,
        rules: [
          { type: "requireAdr", id: "ghost", match: ["src/x/**"], adr: "0042", reason: "r", severity: "error" },
        ],
      },
    );
    try {
      const view = buildConstraintView(ctx);
      expect(view.rules.adrRequirements[0]?.adrStatus).toBe("missing");
    } finally {
      cleanup(ctx);
    }
  });
});

describe("validateContracts (validate_contracts)", () => {
  it("clean repo is consistent with zero errors", () => {
    const ctx = repo(
      {
        ...BASE_DOCS,
        "docs/adr/0001-core.md": '---\nid: "0001"\nstatus: accepted\n---\n# ADR-0001: Core\n',
      },
      {
        version: 1,
        rules: [
          { type: "requireAdr", id: "ra", match: ["src/records/**"], adr: "0001", reason: "governed", severity: "error" },
        ],
      },
    );
    try {
      const report = validateContractsTool(ctx);
      expect(report.consistent).toBe(true);
      expect(report.summary.errors).toBe(0);
    } finally {
      cleanup(ctx);
    }
  });

  it("flags requireAdr pointing at a nonexistent ADR", () => {
    const ctx = repo(
      BASE_DOCS,
      {
        version: 1,
        rules: [
          { type: "requireAdr", id: "ghost", match: ["src/**"], adr: "0042", reason: "r", severity: "error" },
        ],
      },
    );
    try {
      const report = validateContracts(ctx);
      expect(report.consistent).toBe(false);
      expect(report.checks.some((c) => c.kind === "adr-missing" && c.message.includes("0042"))).toBe(true);
    } finally {
      cleanup(ctx);
    }
  });

  it("flags a supersede chain whose old ADR was not flipped", () => {
    const ctx = repo(
      {
        ...BASE_DOCS,
        "docs/adr/0001-old.md": '---\nid: "0001"\nstatus: accepted\n---\n# ADR-0001: Old\n',
        "docs/adr/0002-new.md": '---\nid: "0002"\nstatus: accepted\nsupersedes: "0001"\n---\n# ADR-0002: New\n',
      },
      MIN_RULES,
    );
    try {
      const report = validateContracts(ctx);
      expect(report.consistent).toBe(false);
      expect(report.checks.some((c) => c.kind === "supersede-status" && c.message.includes("0001"))).toBe(true);
    } finally {
      cleanup(ctx);
    }
  });

  it("passes a correct supersede chain", () => {
    const ctx = repo(
      {
        ...BASE_DOCS,
        "docs/adr/0001-old.md": '---\nid: "0001"\nstatus: superseded\n---\n# ADR-0001: Old\n',
        "docs/adr/0002-new.md": '---\nid: "0002"\nstatus: accepted\nsupersedes: "0001"\n---\n# ADR-0002: New\n',
      },
      MIN_RULES,
    );
    try {
      const report = validateContracts(ctx);
      expect(report.consistent).toBe(true);
    } finally {
      cleanup(ctx);
    }
  });

  it("flags superseded references to nonexistent ADRs and duplicate ids", () => {
    const ctx = repo(
      {
        ...BASE_DOCS,
        "docs/adr/0001-a.md": '---\nid: "0001"\nstatus: accepted\nsupersedes: "0009"\n---\n# A\n',
        "docs/adr/0001-b.md": '---\nid: "0001"\nstatus: proposed\n---\n# B\n',
      },
      MIN_RULES,
    );
    try {
      const report = validateContracts(ctx);
      expect(report.checks.some((c) => c.kind === "supersede-missing")).toBe(true);
      expect(report.checks.some((c) => c.kind === "adr-duplicate-id")).toBe(true);
    } finally {
      cleanup(ctx);
    }
  });

  it("warns when a doc-update rule targets a missing doc", () => {
    const ctx = repo(
      BASE_DOCS,
      {
        version: 1,
        rules: [
          { type: "requireDocUpdate", id: "rd", match: ["src/**"], docs: ["docs/GHOST.md"], reason: "docs", severity: "warning" },
        ],
      },
    );
    try {
      const report = validateContracts(ctx);
      expect(report.checks.some((c) => c.kind === "doc-target-missing")).toBe(true);
      expect(report.summary.errors).toBe(0);
    } finally {
      cleanup(ctx);
    }
  });

  it("warns when layer names are absent from ARCHITECTURE.md", () => {
    const ctx = repo(
      { ...BASE_DOCS, "docs/ARCHITECTURE.md": "# Architecture\nNothing about hexagons.\n" },
      {
        version: 1,
        rules: [
          {
            type: "layerDependency",
            id: "hex",
            layers: [
              { name: "hexagonal-ui", globs: ["src/ui/**"] },
              { name: "hexagonal-core", globs: ["src/core/**"] },
            ],
            direction: "inward-only",
            reason: "r",
            severity: "error",
          },
        ],
      },
    );
    try {
      const report = validateContracts(ctx);
      expect(report.checks.some((c) => c.kind === "layers-undocumented" && c.message.includes("hexagonal-core"))).toBe(true);
    } finally {
      cleanup(ctx);
    }
  });
});
