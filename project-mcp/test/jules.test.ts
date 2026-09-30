import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadProjectContext, type ProjectContext } from "../src/config.js";
import type { RulesFile } from "../src/config.js";
import { gitRead, prepareJulesTask, validateJulesReady, validateJulesResult } from "../src/jules.js";

const RULES: RulesFile = {
  version: 1,
  rules: [
    { type: "forbidden", id: "no-dist", match: ["dist/**"], reason: "Build output.", severity: "error" },
    {
      type: "requireTest",
      id: "src-tests",
      match: ["src/**/*.ts"],
      testMatch: ["**/*.test.ts"],
      testExempt: [],
      reason: "Ship tests.",
      severity: "error",
    },
  ],
};

function gitRepo(
  files: Record<string, string>,
  opts: { commit?: boolean; withInstall?: boolean } = {},
): ProjectContext {
  const root = mkdtempSync(join(tmpdir(), "pmc-jules-"));
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  writeFileSync(join(root, "mcp-rules.json"), JSON.stringify(RULES));
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  if (opts.withInstall !== false) {
    // valid install state for the gate (ignored by git so the tree stays clean)
    mkdirSync(join(root, "project-mcp/node_modules"), { recursive: true });
    writeFileSync(join(root, "project-mcp/package-lock.json"), "{}\n");
  }
  for (const [path, content] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, content);
  }
  const run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  run(["init", "-q", "--initial-branch=main"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  run(["add", "-A"]);
  run(["commit", "-qm", "init"]);
  if (opts.commit === false) {
    // leave the working tree with an uncommitted change
    writeFileSync(join(root, "CHANGELOG.md"), "## unreleased\n");
  }
  return loadProjectContext(root);
}

function cleanup(ctx: ProjectContext): void {
  rmSync(ctx.projectRoot, { recursive: true, force: true });
}

describe("gitRead allowlist", () => {
  it("runs allowlisted subcommands and refuses others", () => {
    const ctx = gitRepo({ "README.md": "# T\n" });
    try {
      expect(gitRead(ctx.projectRoot, "status", ["--porcelain"]).ok).toBe(true);
      expect(gitRead(ctx.projectRoot, "push", ["origin", "main"]).ok).toBe(false);
      expect(gitRead(ctx.projectRoot, "push").out).toContain("not allowlisted");
    } finally {
      cleanup(ctx);
    }
  });
});

describe("validateJulesReady", () => {
  it("passes on a clean, committed repo with criteria and tests", () => {
    const ctx = gitRepo({ "README.md": "# T\n", "src/a.ts": "export const a = 1;\n" });
    try {
      const report = validateJulesReady(ctx, {
        acceptanceCriteria: ["Exports a"],
        testFiles: ["src/a.test.ts"],
      });
      expect(report.ready).toBe(true);
      expect(report.branch).toBe("main");
      expect(report.blockers).toHaveLength(0);
      const names = report.checks.map((c) => c.name);
      expect(names).toContain("git-clean");
      expect(names).toContain("remote-fresh");
      expect(names).toContain("no-agent-conflict");
    } finally {
      cleanup(ctx);
    }
  });

  it("blocks on dirty tree (unless requireClean:false) and missing criteria/tests", () => {
    const ctx = gitRepo({ "README.md": "# T\n" }, { commit: false });
    try {
      const strict = validateJulesReady(ctx, { acceptanceCriteria: [], testFiles: [] });
      expect(strict.ready).toBe(false);
      expect(strict.checks.find((c) => c.name === "git-clean")?.pass).toBe(false);
      expect(strict.checks.find((c) => c.name === "acceptance-criteria")?.pass).toBe(false);
      expect(strict.checks.find((c) => c.name === "tests-identified")?.pass).toBe(false);

      const lenient = validateJulesReady(ctx, {
        acceptanceCriteria: ["criterion"],
        testFiles: ["test.ts"],
        requireClean: false,
      });
      expect(lenient.checks.find((c) => c.name === "changes-accounted")?.pass).toBe(true);
    } finally {
      cleanup(ctx);
    }
  });

  it("flags missing install state", () => {
    const ctx = gitRepo({ "README.md": "# T\n" }, { withInstall: false });
    try {
      const report = validateJulesReady(ctx, { acceptanceCriteria: ["c"], testFiles: ["t.ts"] });
      const install = report.checks.find((c) => c.name === "install-valid");
      expect(install?.pass).toBe(false); // fixture has no project-mcp/node_modules
      expect(report.ready).toBe(false);
    } finally {
      cleanup(ctx);
    }
  });
});

describe("prepareJulesTask", () => {
  it("packages context, constraints, and the jules CLI contract", () => {
    const ctx = gitRepo({
      "README.md": "# T\n",
      "src/records/store.ts": "export function storeRecord(): void {}\n",
      "src/records/store.test.ts": "it('stores', () => {});\n",
    });
    try {
      const pkg = prepareJulesTask(ctx, {
        description: "Add record export",
        plannedPaths: ["src/records/store.ts"],
        acceptanceCriteria: ["Store exports a record function"],
        testFiles: ["src/records/store.test.ts"],
      });
      expect(pkg.task.plannedPaths).toEqual(["src/records/store.ts"]);
      expect(pkg.context.items.length).toBeGreaterThan(0);
      expect(pkg.context.compressedLines).toBeLessThanOrEqual(400 * 1.25 + 1);
      expect(pkg.constraints.forbiddenPaths).toContain("dist/**");
      expect(pkg.dispatch.tool).toBe("jules-cli");
      expect(pkg.dispatch.commandTemplate).toContain("jules submit --repo");
      expect(pkg.dispatch.runBy).toBe("hermes-or-human");
      expect(pkg.dispatch.note).toContain("does not dispatch");
    } finally {
      cleanup(ctx);
    }
  });
});

describe("validateJulesResult", () => {
  it("accepts a governed change set and rejects a test-less src change", () => {
    const ctx = gitRepo({ "README.md": "# T\n" });
    try {
      const good = validateJulesResult(ctx, {
        branch: "main",
        changes: [
          { path: "src/feature.ts", changeType: "create" },
          { path: "src/feature.test.ts", changeType: "create" },
        ],
        acceptanceCriteria: ["works"],
        claimedPassingTests: ["src/feature.test.ts"],
      });
      expect(good.accepted).toBe(true);
      expect(good.violations).toHaveLength(0);
      expect(good.nextSteps.join(" ")).toContain("CI");

      const bad = validateJulesResult(ctx, {
        branch: "main",
        changes: [{ path: "src/unguarded.ts", changeType: "create" }],
        acceptanceCriteria: [],
      });
      expect(bad.accepted).toBe(false);
      expect(bad.violations.some((v) => v.ruleId === "src-tests")).toBe(true);
      expect(bad.requiredActions.length).toBeGreaterThan(0);
    } finally {
      cleanup(ctx);
    }
  });

  it("rejects forbidden paths via the rule engine", () => {
    const ctx = gitRepo({ "README.md": "# T\n" });
    try {
      const verdict = validateJulesResult(ctx, {
        branch: "main",
        changes: [{ path: "dist/bundle.js", changeType: "create" }],
        acceptanceCriteria: [],
      });
      expect(verdict.accepted).toBe(false);
      expect(verdict.violations[0]?.ruleId).toBe("no-dist");
    } finally {
      cleanup(ctx);
    }
  });
});
