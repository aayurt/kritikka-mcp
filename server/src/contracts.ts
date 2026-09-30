import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { safeRead, type ProjectContext, type ProjectRule } from "./config.js";
import { listAdrs } from "./readers.js";

/**
 * Repository contracts: discovery of contract-bearing docs, compilation of
 * machine constraints into an agent-facing view, and consistency checks
 * between prose contracts (docs/ADRs) and the machine contract
 * (mcp-rules.json). Read-only; the foundation for context optimization later.
 */

/** Well-known contract roles; docs are discovered by filename, not hardcoded presence. */
const KNOWN_DOCS: { path: string; role: string }[] = [
  { path: "README.md", role: "identity" },
  { path: "AGENTS.md", role: "agent-rules" },
  { path: "CONTRIBUTING.md", role: "contribution" },
  { path: "RUNBOOK.md", role: "operations" },
  { path: "DEPLOYMENT.md", role: "deployment" },
  { path: "docs/ARCHITECTURE.md", role: "architecture" },
  { path: "docs/CONVENTIONS.md", role: "conventions" },
  { path: "docs/DEVELOPMENT.md", role: "development" },
  { path: "docs/TESTING.md", role: "testing" },
  { path: "mcp-rules.json", role: "machine-rules" },
];

/** Discover .md contracts in docs/ beyond the well-known set (e.g. CONTRACTS.md). */
function discoverDocDocs(projectRoot: string): { path: string; role: string }[] {
  const out: { path: string; role: string }[] = [];
  const docsDir = join(projectRoot, "docs");
  let entries: string[];
  try {
    entries = readdirSync(docsDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const path = `docs/${name}`;
    if (KNOWN_DOCS.some((k) => k.path === path)) continue;
    out.push({ path, role: name.replace(/\.md$/, "").toLowerCase() });
  }
  return out;
}

export interface DiscoveredDoc {
  path: string;
  role: string;
  present: boolean;
  /** Which subsystem serves it: docs | adrs | rules | none (missing). */
  source: "root-doc" | "docs-dir" | "adr-dir" | "rules-file" | "missing";
}

export function discoverContracts(ctx: ProjectContext): DiscoveredDoc[] {
  const out: DiscoveredDoc[] = KNOWN_DOCS.map((k) => ({
    ...k,
    present: existsSync(join(ctx.projectRoot, k.path)),
    source: k.path === "mcp-rules.json" ? "rules-file" : k.path.startsWith("docs/") ? "docs-dir" : "root-doc",
  }));
  for (const d of discoverDocDocs(ctx.projectRoot)) {
    out.push({ ...d, present: true, source: "docs-dir" });
  }
  const adrDirPresent = existsSync(join(ctx.projectRoot, "docs/adr"));
  out.push({
    path: "docs/adr",
    role: "decisions",
    present: adrDirPresent && listAdrs(ctx.projectRoot).length > 0,
    source: "adr-dir",
  });
  return out;
}

export interface ConstraintView {
  projectRoot: string;
  docIndex: { path: string; role: string; present: boolean }[];
  rules: {
    forbidden: { id: string; match: string[]; severity: string; reason: string }[];
    adrRequirements: { id: string; match: string[]; adr: string; severity: string; adrStatus: string }[];
    testRequirements: { id: string; match: string[]; testMatch: string[]; testExempt: string[]; severity: string }[];
    docUpdateRequirements: { id: string; match: string[]; docs: string[]; severity: string }[];
    layerPolicies: {
      id: string;
      severity: string;
      direction: string;
      layers: { name: string; globs: string[] }[];
    }[];
  };
  adrIndex: { id: string; title: string; status: string; file: string }[];
  agentGuidance: string[];
}

/** Compile the machine contract plus ADR statuses into one agent-facing view. */
export function buildConstraintView(ctx: ProjectContext): ConstraintView {
  const byType = <T extends ProjectRule["type"]>(t: T) =>
    ctx.rules.rules.filter((r): r is Extract<ProjectRule, { type: T }> => r.type === t);
  const adrs = listAdrs(ctx.projectRoot);
  const adrStatus = (id: string): string => adrs.find((a) => a.id === id)?.status ?? "missing";

  return {
    projectRoot: ctx.projectRoot,
    docIndex: discoverContracts(ctx)
      .filter((d) => d.source !== "adr-dir")
      .map((d) => ({ path: d.path, role: d.role, present: d.present })),
    rules: {
      forbidden: byType("forbidden").map((r) => ({
        id: r.id,
        match: r.match,
        severity: r.severity,
        reason: r.reason,
      })),
      adrRequirements: byType("requireAdr").map((r) => ({
        id: r.id,
        match: r.match,
        adr: r.adr,
        severity: r.severity,
        adrStatus: adrStatus(r.adr),
      })),
      testRequirements: byType("requireTest").map((r) => ({
        id: r.id,
        match: r.match,
        testMatch: r.testMatch,
        testExempt: r.testExempt,
        severity: r.severity,
      })),
      docUpdateRequirements: byType("requireDocUpdate").map((r) => ({
        id: r.id,
        match: r.match,
        docs: r.docs,
        severity: r.severity,
      })),
      layerPolicies: byType("layerDependency").map((r) => ({
        id: r.id,
        severity: r.severity,
        direction: r.direction,
        layers: r.layers,
      })),
    },
    adrIndex: adrs.map((a) => ({ id: a.id, title: a.title, status: a.status, file: a.file })),
    agentGuidance: [
      "Run get_constraints once, not four doc fetches.",
      "Before writing files, pass the planned change set through validate_change.",
      "Paths under a requireAdr rule need the referenced ADR accepted first.",
      "Imports must respect layerPolicies direction (inward-only).",
    ],
  };
}

export interface ContractCheck {
  kind: string;
  severity: "error" | "warning";
  message: string;
  path?: string | undefined;
}

export interface ContractsReport {
  consistent: boolean;
  docs: DiscoveredDoc[];
  checks: ContractCheck[];
  summary: { errors: number; warnings: number };
}

/** Cross-contract consistency: machine vs prose, ADR lifecycle, rule sanity. */
export function validateContracts(ctx: ProjectContext): ContractsReport {
  const checks: ContractCheck[] = [];
  const adrs = listAdrs(ctx.projectRoot);
  const docs = discoverContracts(ctx);
  const rules = ctx.rules.rules;

  // 1. requireAdr targets must exist
  for (const rule of rules) {
    if (rule.type !== "requireAdr") continue;
    const adr = adrs.find((a) => a.id === rule.adr);
    if (!adr) {
      checks.push({
        kind: "adr-missing",
        severity: "error",
        message: `Rule "${rule.id}" requires ADR-${rule.adr}, but no ADR with that id exists.`,
      });
    }
  }

  // 2. ADR lifecycle: supersede chains must flip the old ADR's status
  const byId = new Map(adrs.map((a) => [a.id, a]));
  for (const adr of adrs) {
    for (const oldId of adr.supersedes) {
      const old = byId.get(oldId);
      if (!old) {
        checks.push({
          kind: "supersede-missing",
          severity: "error",
          message: `${adr.file} supersedes ADR-${oldId}, which does not exist.`,
          path: adr.file,
        });
      } else if (old.status !== "superseded") {
        checks.push({
          kind: "supersede-status",
          severity: "error",
          message: `${adr.file} supersedes ADR-${oldId}, but ADR-${oldId} is still "${old.status}"; flip its status to "superseded".`,
          path: old.file,
        });
      }
    }
  }

  // 3. Duplicate ADR ids
  const seen = new Set<string>();
  for (const adr of adrs) {
    if (seen.has(adr.id)) {
      checks.push({
        kind: "adr-duplicate-id",
        severity: "error",
        message: `Duplicate ADR id ${adr.id} (${adr.file}).`,
        path: adr.file,
      });
    }
    seen.add(adr.id);
  }

  // 4. Rules that reference doc paths which do not exist
  for (const rule of rules) {
    if (rule.type !== "requireDocUpdate") continue;
    for (const doc of rule.docs) {
      if (!existsSync(join(ctx.projectRoot, doc))) {
        checks.push({
          kind: "doc-target-missing",
          severity: "warning",
          message: `Rule "${rule.id}" requires updates to ${doc}, which does not exist.`,
          path: doc,
        });
      }
    }
  }

  // 5. Layer rules should be reflected in prose (docs/ARCHITECTURE.md)
  const layerRules = rules.filter((r) => r.type === "layerDependency");
  const archRead = docs.find((d) => d.path === "docs/ARCHITECTURE.md");
  for (const rule of layerRules) {
    if (!archRead?.present) {
      checks.push({
        kind: "layers-undocumented",
        severity: "warning",
        message: `Layer policy "${rule.id}" exists but docs/ARCHITECTURE.md is missing; document the layers in prose.`,
      });
      continue;
    }
    const read = readArchitecture(ctx);
    const typed = rule as { id: string; layers: { name: string }[] };
    const missing = typed.layers.filter((l) => !read.toLowerCase().includes(l.name.toLowerCase()));
    if (missing.length > 0) {
      checks.push({
        kind: "layers-undocumented",
        severity: "warning",
        message: `Layer policy "${rule.id}" names layers absent from docs/ARCHITECTURE.md: ${missing.map((m) => m.name).join(", ")}.`,
      });
    }
  }

  const errors = checks.filter((c) => c.severity === "error").length;
  return {
    consistent: errors === 0,
    docs,
    checks,
    summary: { errors, warnings: checks.length - errors },
  };
}

/** Architecture doc content, or empty string when absent. */
function readArchitecture(ctx: ProjectContext): string {
  const read = safeRead(ctx.projectRoot, "docs/ARCHITECTURE.md");
  return read.found ? read.content : "";
}
