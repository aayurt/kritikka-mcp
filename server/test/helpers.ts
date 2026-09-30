import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectContext, type ProjectContext } from "../src/config.js";
import type { RulesFile } from "../src/config.js";

/** Rules used when a fixture repo does not override them. */
export const DEFAULT_FIXTURE_RULES: RulesFile = {
  version: 1,
  rules: [
    {
      type: "forbidden",
      id: "no-internal-state",
      match: [".freebuff/**", "dist/**", "node_modules/**"],
      reason: "Internal state and build output are not part of the reviewed repository.",
      severity: "error",
    },
    {
      type: "requireAdr",
      id: "records-engine-governed",
      match: ["src/records/**"],
      adr: "0001",
      reason: "Record persistence is governed by ADR-0001.",
      severity: "error",
    },
    {
      type: "requireTest",
      id: "src-needs-tests",
      match: ["src/**/*.ts"],
      testMatch: ["**/*.test.ts", "test/**"],
      testExempt: ["**/*.d.ts"],
      reason: "Every source change ships tests.",
      severity: "error",
    },
    {
      type: "requireDocUpdate",
      id: "architecture-docs-stale",
      match: ["src/records/**"],
      docs: ["docs/ARCHITECTURE.md"],
      reason: "Keep docs/ARCHITECTURE.md current.",
      severity: "warning",
    },
  ],
};

export interface FixtureOptions {
  /** Overrides the default rules file written at the repo root. */
  rules?: RulesFile;
  /** Extra files to write, keyed by repo-relative path. */
  files?: Record<string, string>;
}

/** In-memory ADR content used by the fixture builder. */
function adr(id: string, title: string, status: string, date = "2026-01-01"): string {
  return `---\nid: "${id}"\ntitle: "${title}"\nstatus: ${status}\ndate: ${date}\n---\n\n# ADR-${id}: ${title}\n\nBody of ADR-${id}.\n`;
}

/**
 * Create a fixture repo in the OS tmp dir, write docs/ADRs/rules into it,
 * and return its absolute path. Caller must rm the path when done.
 */
export function makeFixtureRepo(options: FixtureOptions = {}): string {
  const root = mkdtempSync(join(tmpdir(), "kritikka-fixture-"));
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  mkdirSync(join(root, "docs/guides"), { recursive: true });

  writeFileSync(join(root, "mcp-rules.json"), JSON.stringify(options.rules ?? DEFAULT_FIXTURE_RULES));
  writeFileSync(join(root, "README.md"), "# Fixture Repo\n\nA fixture repository for tests.\n");
  writeFileSync(join(root, "AGENTS.md"), "# Agent Instructions\nRead before writing.\n");
  writeFileSync(join(root, "CONTRIBUTING.md"), "# Contributing\nBranch, test, PR.\n");
  writeFileSync(join(root, "RUNBOOK.md"), "# Runbook\nDeploy and roll back.\n");
  writeFileSync(join(root, "docs/ARCHITECTURE.md"), "# Architecture\nRecords via the engine.\n");
  writeFileSync(join(root, "docs/CONVENTIONS.md"), "# Conventions\nkebab-case files.\n");
  writeFileSync(join(root, "docs/DEVELOPMENT.md"), "# Development\nDaily loop.\n");
  writeFileSync(join(root, "docs/TESTING.md"), "# Testing\nShip tests.\n");
  writeFileSync(join(root, "docs/adr/0000-template.md"), adr("0000", "Template", "template"));
  writeFileSync(join(root, "docs/adr/0001-record-storage-engine.md"), adr("0001", "Record storage engine", "accepted"));
  writeFileSync(join(root, "docs/adr/0002-isolate-background-queues.md"), adr("0002", "Isolate background queues", "proposed"));
  writeFileSync(join(root, "docs/guides/debugging.md"), "# Debugging\nReproduce first.\n");
  for (const [path, content] of Object.entries(options.files ?? {})) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

export function removeFixtureRepo(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Load a ProjectContext for a fixture root. */
export function fixtureContext(root: string): ProjectContext {
  return loadProjectContext(root);
}
