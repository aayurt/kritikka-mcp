// Live smoke test: spawns the stdio server as a real MCP client and calls
// every tool. Run: node scripts/smoke.mjs <absolute-repo-root>
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(process.argv[2] ?? resolve(here, "../.."));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve(here, "../build/index.js"), "--root", repoRoot],
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`);
  }
}
const text = (res) => JSON.parse(res.content[0].text);

// 1. identity
const identity = text(await client.callTool({ name: "get_project_identity", arguments: {} }));
check("identity.name", identity.name === "Project MCP Playground", identity.name);
check("identity.description", typeof identity.description === "string" && identity.description.length > 0);
check("identity.inventory", identity.docInventory.length > 0 && identity.docInventory.every((d) => typeof d.present === "boolean"));

// 2. architecture
const arch = text(await client.callTool({ name: "get_architecture_rules", arguments: {} }));
check("arch.found", arch.architecture.found === true);
check("arch.adrIndex", arch.adrIndex.length === 3 && arch.adrIndex[1].status === "accepted", JSON.stringify(arch.adrIndex));

// 3. conventions
const conv = text(await client.callTool({ name: "get_conventions", arguments: {} }));
check("conventions.found", conv.conventions.found && conv.contributing.found);

// 4. ADRs
const adrs = text(await client.callTool({ name: "get_current_adrs", arguments: {} }));
check("adrs.count", adrs.count === 3, adrs.count);
const proposed = text(await client.callTool({ name: "get_current_adrs", arguments: { status: "proposed" } }));
check("adrs.filter", proposed.count === 1 && proposed.adrs[0].id === "0002");
const adr1 = text(await client.callTool({ name: "get_current_adrs", arguments: { id: "0001", includeContent: true } }));
check("adrs.content", adr1.adrs[0].content.includes("# ADR-0001"));
const adrMiss = text(await client.callTool({ name: "get_current_adrs", arguments: { id: "9999" } }));
check("adrs.miss-hint", adrMiss.found === false && typeof adrMiss.hint === "string");

// 5. workflow
const wf = text(await client.callTool({ name: "get_workflow", arguments: {} }));
check("workflow.found", wf.runbook.found && wf.contributing.found && wf.development.found);

// 6. testing requirements
const test = text(await client.callTool({ name: "get_testing_requirements", arguments: {} }));
check("testing.found", test.testing.found);

// 7. validate_change
const okChange = text(
  await client.callTool({
    name: "validate_change",
    arguments: {
      changes: [
        { path: "src/util.ts", changeType: "create" },
        { path: "src/util.test.ts", changeType: "create" },
      ],
    },
  }),
);
check("validate.clean", okChange.valid === true && okChange.violations.length === 0, JSON.stringify(okChange.violations));

const queueChange = text(
  await client.callTool({
    name: "validate_change",
    arguments: { changes: [{ path: "src/queues/worker.ts", changeType: "create" }] },
  }),
);
check(
  "validate.adr-not-accepted",
  queueChange.valid === false &&
    queueChange.violations.some((v) => v.ruleId === "queues-governed" && v.message.includes("proposed")),
  JSON.stringify(queueChange.violations),
);

const noTest = text(
  await client.callTool({
    name: "validate_change",
    arguments: { changes: [{ path: "src/index.ts", changeType: "modify" }] },
  }),
);
check(
  "validate.requires-test",
  noTest.valid === false && noTest.violations.some((v) => v.ruleId === "src-needs-tests"),
  JSON.stringify(noTest.violations),
);

const docWarn = text(
  await client.callTool({
    name: "validate_change",
    arguments: {
      changes: [
        { path: "src/records/store.ts", changeType: "modify" },
        { path: "src/records/store.test.ts", changeType: "create" },
      ],
    },
  }),
);
check(
  "validate.doc-warning-advisory",
  docWarn.valid === true &&
    docWarn.warnings.some((w) => w.ruleId === "architecture-docs-stale") &&
    docWarn.requiredActions.length > 0,
  JSON.stringify({ valid: docWarn.valid, warnings: docWarn.warnings }),
);

const forbiddenChange = text(
  await client.callTool({
    name: "validate_change",
    arguments: { changes: [{ path: "node_modules/x/index.js", changeType: "modify" }] },
  }),
);
check("validate.forbidden", forbiddenChange.valid === false, JSON.stringify(forbiddenChange.violations));

// SDK validates inputSchema at the boundary; expect an isError result citing the missing path.
const badRes = await client.callTool({ name: "validate_change", arguments: { changes: [{ changeType: "create" }] } });
check(
  "validate.invalid-input-rejected",
  badRes.isError === true && badRes.content[0].text.includes("-32602") && badRes.content[0].text.includes("changes[0].path"),
  JSON.stringify(badRes).slice(0, 200),
);

// 8. boundary
const boundary = text(
  await client.callTool({
    name: "check_repository_boundary",
    arguments: {
      paths: ["src/ok.ts", "../escape.txt", "/etc/hosts", "dist/bundle.js", ".freebuff/state"],
      operation: "write",
    },
  }),
);
const byPath = Object.fromEntries(boundary.results.map((r) => [r.path, r]));
check("boundary.clean", byPath["src/ok.ts"].allowed === true);
check("boundary.traversal", byPath["../escape.txt"].insideRepo === false && !byPath["../escape.txt"].allowed);
check("boundary.absolute", byPath["/etc/hosts"].insideRepo === false);
check("boundary.forbidden-dist", byPath["dist/bundle.js"].insideRepo === true && byPath["dist/bundle.js"].allowed === false && byPath["dist/bundle.js"].matchedRule === "no-internal-state");
check("boundary.forbidden-freebuff", byPath[".freebuff/state"].allowed === false);

await client.close();
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
