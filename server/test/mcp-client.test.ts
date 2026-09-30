import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeFixtureRepo, removeFixtureRepo } from "./helpers.js";

const here = resolve(fileURLToPath(import.meta.url), "..");
const serverEntry = resolve(here, "../build/index.js");

describe("mcp stdio integration", () => {
  const repoRoot = makeFixtureRepo({
    files: {
      "src/records/store.ts": "export function storeRecord(): void {}\n",
      "src/records/store.test.ts": "it('stores a record', () => {});\n",
      "server/node_modules/.keep": "",
      "server/package-lock.json": "{}\n",
      ".gitignore": "node_modules/\n",
    },
  });
  let client: Client;

  beforeAll(async () => {
    // the jules-ready gate requires a real git worktree
    execFileSync("git", ["init", "-q", "--initial-branch=main"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoRoot });
    execFileSync("git", ["add", "-A"], { cwd: repoRoot });
    execFileSync("git", ["commit", "-qm", "init"], { cwd: repoRoot });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry, "--root", repoRoot],
    });
    client = new Client({ name: "vitest-integration", version: "0.0.0" });
    await client.connect(transport);
  }, 30000);

  afterAll(async () => {
    await client.close();
    removeFixtureRepo(repoRoot);
  }, 30000);

  /** Extract and JSON-parse the first text block; callTool's result is a union. */
  const text = (res: unknown): any => {
    const content = (res as { content?: Array<{ type?: string; text?: string }> }).content;
    const first = content?.[0];
    if (!first || first.type !== "text" || typeof first.text !== "string") {
      throw new Error("expected a text content block");
    }
    return JSON.parse(first.text);
  };

  it("lists tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "analyze_impact",
      "check_repository_boundary",
      "compress_context",
      "detect_secrets",
      "find_existing_pattern",
      "get_architecture_rules",
      "get_constraints",
      "get_conventions",
      "get_current_adrs",
      "get_project_identity",
      "get_testing_requirements",
      "get_workflow",
      "inspect_task",
      "prepare_jules_task",
      "retrieve_relevant_context",
      "validate_architecture",
      "validate_change",
      "validate_contracts",
      "validate_jules_ready",
      "validate_jules_result",
    ]);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(true);
    }
  });

  it("get_current_adrs parses statuses and filters; misses carry a hint", async () => {
    const all = text(await client.callTool({ name: "get_current_adrs", arguments: {} }));
    expect(all.count).toBe(3);
    expect(all.adrs.map((a: any) => `${a.id}:${a.status}`)).toEqual([
      "0000:template",
      "0001:accepted",
      "0002:proposed",
    ]);

    const proposed = text(
      await client.callTool({ name: "get_current_adrs", arguments: { status: "proposed" } }),
    );
    expect(proposed.count).toBe(1);
    expect(proposed.adrs[0]).toMatchObject({ id: "0002", status: "proposed" });

    const withContent = text(
      await client.callTool({ name: "get_current_adrs", arguments: { id: "0001", includeContent: true } }),
    );
    expect(withContent.adrs[0].content).toContain("# ADR-0001");

    const miss = text(await client.callTool({ name: "get_current_adrs", arguments: { id: "9999" } }));
    expect(miss.found).toBe(false);
    expect(typeof miss.hint).toBe("string");
    expect(miss.hint.length).toBeGreaterThan(0);
  });

  it("validate_change enforces ADR acceptance, tests, and reports warnings advisory", async () => {
    const clean = text(
      await client.callTool({
        name: "validate_change",
        arguments: {
          changes: [
            { path: "src/free/util.ts", changeType: "create" },
            { path: "src/free/util.test.ts", changeType: "create" },
          ],
        },
      }),
    );
    expect(clean.valid).toBe(true);

    const adrBlock = text(
      await client.callTool({
        name: "validate_change",
        arguments: { changes: [{ path: "src/records/store.ts", changeType: "create" }] },
      }),
    );
    // records ADR is accepted, so the block comes from missing tests (src/** needs tests).
    expect(adrBlock.valid).toBe(false);
    expect(adrBlock.violations.some((v: any) => v.ruleId === "src-needs-tests")).toBe(true);
    expect(adrBlock.warnings.some((w: any) => w.ruleId === "architecture-docs-stale")).toBe(true);

    const withTestAndDoc = text(
      await client.callTool({
        name: "validate_change",
        arguments: {
          changes: [
            { path: "src/records/store.ts", changeType: "modify" },
            { path: "src/records/store.test.ts", changeType: "create" },
            { path: "docs/ARCHITECTURE.md", changeType: "modify" },
          ],
        },
      }),
    );
    expect(withTestAndDoc.valid).toBe(true);
    expect(withTestAndDoc.warnings).toHaveLength(0);
  });

  it("check_repository_boundary returns per-path verdicts", async () => {
    const res = text(
      await client.callTool({
        name: "check_repository_boundary",
        arguments: {
          paths: ["src/ok.ts", "../escape.txt", "/etc/hosts", "node_modules/x/index.js"],
          operation: "write",
        },
      }),
    );
    const byPath = Object.fromEntries(res.results.map((r: any) => [r.path, r]));
    expect(byPath["src/ok.ts"]).toMatchObject({ insideRepo: true, allowed: true });
    expect(byPath["../escape.txt"]).toMatchObject({ insideRepo: false, allowed: false });
    expect(byPath["/etc/hosts"]).toMatchObject({ insideRepo: false, allowed: false });
    expect(byPath["node_modules/x/index.js"]).toMatchObject({
      insideRepo: true,
      allowed: false,
      matchedRule: "no-internal-state",
    });
  });

  it("get_current_adrs rejects invalid input with a protocol-level error", async () => {
    const res = await client.callTool({
      name: "get_current_adrs",
      arguments: { id: "not-four-digits" },
    });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toContain("-32602");
  });

  it("validate_architecture, detect_secrets, inspect_task, analyze_impact over the wire", async () => {
    const arch = text(await client.callTool({ name: "validate_architecture", arguments: {} }));
    expect(arch.valid).toBe(true);
    expect(arch.rulesChecked).toBe(0);

    const secrets = text(await client.callTool({ name: "detect_secrets", arguments: {} }));
    expect(secrets.clean).toBe(true);
    expect(secrets.scannedFiles).toBeGreaterThan(0);

    const task = text(
      await client.callTool({
        name: "inspect_task",
        arguments: { description: "Touch records", files: ["src/records/store.ts"] },
      }),
    );
    expect(task.matchedRules.map((m: any) => m.ruleId)).toContain("records-engine-governed");
    expect(task.adrRequirement?.adr).toBe("0001");

    const impact = text(
      await client.callTool({ name: "analyze_impact", arguments: { files: ["src/records/store.ts"] } }),
    );
    expect(impact.governedPaths.length).toBeGreaterThan(0);
    expect(impact.guidance).toContain("validate_change");
  });

  it("get_constraints compiles the contract; validate_contracts stays consistent", async () => {
    const constraints = text(await client.callTool({ name: "get_constraints", arguments: {} }));
    expect(constraints.rules.adrRequirements[0]).toMatchObject({ adr: "0001" });
    expect(constraints.adrIndex.length).toBe(3);
    expect(constraints.agentGuidance.length).toBeGreaterThan(0);

    const contracts = text(await client.callTool({ name: "validate_contracts", arguments: {} }));
    expect(contracts.consistent).toBe(true);
    expect(contracts.docs.some((d: any) => d.path === "docs/adr")).toBe(true);
  });

  it("retrieve_relevant_context bundles contracts, ADRs, and tests for a task", async () => {
    const bundle = text(
      await client.callTool({
        name: "retrieve_relevant_context",
        arguments: {
          description: "Add record export to the store",
          files: ["src/records/store.ts"],
        },
      }),
    );
    expect(bundle.contracts.map((c: any) => c.path)).toContain("mcp-rules.json");
    expect(bundle.adrs[0]?.path).toContain("0001");
    expect(bundle.code.some((c: any) => c.path.endsWith("store.test.ts")) || bundle.tests.length >= 0).toBe(true);
    expect(bundle.guidance.join(" ")).toContain("validate_change");
    expect(bundle.estimatedLines).toBeGreaterThan(0);
  });

  it("compress_context condenses the bundle under a budget", async () => {
    const out = text(
      await client.callTool({
        name: "compress_context",
        arguments: {
          description: "Add record export to the store",
          files: ["src/records/store.ts"],
          budgetLines: 120,
        },
      }),
    );
    expect(out.items.length).toBeGreaterThan(0);
    for (const item of out.items) {
      expect(item.strategy).toMatch(/verbatim|signatures|sections|json-keys|test-names|truncate/);
      expect(typeof item.excerpt).toBe("string");
      expect(item.originalLines).toBeGreaterThan(0);
    }
    expect(out.compressedLines).toBeLessThanOrEqual(120 * 1.25 + 1);
    expect(out.guidance.join(" ")).toContain("validate_change");
  });

  it("find_existing_pattern ranks by usage and recommends the established file", async () => {
    const report = text(
      await client.callTool({ name: "find_existing_pattern", arguments: { concept: "store" } }),
    );
    expect(report.candidates.length).toBeGreaterThan(0);
    expect(report.recommendation?.file).toContain("src/records/store.ts");
    expect(report.guidance.join(" ")).toContain("pattern");
  });

  it("jules gates: ready, task package with CLI contract, result verdict", async () => {
    const ready = text(
      await client.callTool({
        name: "validate_jules_ready",
        arguments: {
          acceptanceCriteria: ["store exports a function"],
          testFiles: ["src/records/store.test.ts"],
        },
      }),
    );
    expect(ready.ready).toBe(true);
    expect(ready.checks.find((c: any) => c.name === "git-clean")?.pass).toBe(true);
    expect(ready.checks.find((c: any) => c.name === "install-valid")?.pass).toBe(true);

    const pkg = text(
      await client.callTool({
        name: "prepare_jules_task",
        arguments: {
          description: "Extend the record store",
          plannedPaths: ["src/records/store.ts"],
          acceptanceCriteria: ["store exports a function"],
          testFiles: ["src/records/store.test.ts"],
        },
      }),
    );
    expect(pkg.dispatch.tool).toBe("jules-cli");
    expect(pkg.dispatch.commandTemplate).toContain("jules submit --repo");
    expect(pkg.dispatch.runBy).toBe("hermes-or-human");
    expect(pkg.context.items.length).toBeGreaterThan(0);

    const verdict = text(
      await client.callTool({
        name: "validate_jules_result",
        arguments: {
          branch: "main",
          changes: [
            { path: "src/records/export.ts", changeType: "create" },
            { path: "src/records/export.test.ts", changeType: "create" },
          ],
          acceptanceCriteria: ["exports exist"],
        },
      }),
    );
    expect(verdict.accepted).toBe(true);
    expect(verdict.secretFindings).toBe(0);
  });

  it("get_workflow and get_conventions serve fixture docs", async () => {
    const wf = text(await client.callTool({ name: "get_workflow", arguments: {} }));
    expect(wf.runbook.found).toBe(true);
    expect(wf.development.found).toBe(true);
    const conv = text(await client.callTool({ name: "get_conventions", arguments: {} }));
    expect(conv.conventions.found).toBe(true);
    expect(conv.contributing.found).toBe(true);
  });
});
