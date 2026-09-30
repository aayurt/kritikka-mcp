import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import picomatch from "picomatch";
import { safeRead, type ProjectContext } from "./config.js";
import { listAdrs } from "./readers.js";
import { walkSources } from "./scanner.js";
import { findAdrRequirement, findRuleMatches, findTestRequirement } from "./impact.js";

/**
 * Task-scoped context retrieval: the minimal bundle an agent needs before
 * implementing — the contracts that govern the touched paths, the referenced
 * ADRs, matching test files, and same-directory neighbor modules. Deliberately
 * excludes whole-file dumps of unrelated code; compression comes later.
 */

const KEYWORD_STOP = new Set([
  "add", "the", "a", "an", "to", "for", "of", "in", "on", "and", "or", "with",
  "update", "fix", "refactor", "make", "should", "must", "into", "from", "that",
]);

/** Extract lowercase keyword stems from a free-form task description. */
export function taskKeywords(description: string): string[] {
  return [...new Set(
    description
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !KEYWORD_STOP.has(w)),
  )];
}

export interface ContextItem {
  path: string;
  why: string;
  /** Rough size signal so agents can budget before reading. */
  lines: number;
}

export interface RelevantContext {
  task: { description: string; keywords: string[]; files: string[] };
  contracts: ContextItem[];
  adrs: ContextItem[];
  code: ContextItem[];
  tests: ContextItem[];
  guidance: string[];
  estimatedLines: number;
}

function item(ctx: ProjectContext, path: string, why: string): ContextItem | undefined {
  const read = safeRead(ctx.projectRoot, path);
  if (!read.found) return undefined;
  return { path, why, lines: read.content.split("\n").length };
}

/** Test files that plausibly cover the touched paths (name or directory match). */
function findCandidateTests(ctx: ProjectContext, files: string[]): string[] {
  const all = walkSources(ctx.projectRoot);
  const touchedDirs = new Set(files.map((f) => dirname(f)));
  const touchedStems = new Set(files.map((f) => basename(f).replace(/\.[^.]+$/, "")));
  return all.filter((f) => {
    if (!/\.test\.[tj]sx?$/.test(f) && !/(^|\/)(test|tests|__tests__)\//.test(f)) return false;
    if (touchedDirs.has(dirname(f))) return true;
    const stem = basename(f).replace(/\.test\.[tj]sx?$/, "").replace(/\.[tj]sx?$/, "");
    return touchedStems.has(stem);
  });
}

/** Neighbor modules in the same directory (import-shape reference, not full dumps). */
function findNeighbors(ctx: ProjectContext, files: string[]): string[] {
  const touchedDirs = new Set(files.map((f) => dirname(f)));
  return walkSources(ctx.projectRoot).filter(
    (f) => touchedDirs.has(dirname(f)) && !files.includes(f),
  );
}

/** Build the minimal context bundle for a task and its planned paths. */
export function buildRelevantContext(
  ctx: ProjectContext,
  input: { description: string; files: string[] },
): RelevantContext {
  const keywords = taskKeywords(input.description);
  const files = input.files;
  const contracts: ContextItem[] = [];
  const adrs: ContextItem[] = [];
  const code: ContextItem[] = [];
  const tests: ContextItem[] = [];

  // 1. Contracts: docs named by rules that govern the touched paths + machine rules file
  const matches = findRuleMatches(ctx, files);
  const docTargets = new Set<string>(["mcp-rules.json"]);
  for (const m of matches) {
    if (m.rule.type === "requireDocUpdate") for (const d of m.rule.docs) docTargets.add(d);
  }
  if (files.some((f) => picomatch.isMatch(f, "**/*", { dot: true }))) {
    if (existsSync(join(ctx.projectRoot, "docs/ARCHITECTURE.md"))) docTargets.add("docs/ARCHITECTURE.md");
  }
  for (const path of docTargets) {
    const it = item(ctx, path, "governs the touched paths");
    if (it) contracts.push(it);
  }

  // 2. ADRs: required by rules, or keyword-matched titles
  const adrRequirement = findAdrRequirement(ctx, files);
  const seenAdr = new Set<string>();
  if (adrRequirement) {
    for (const adr of listAdrs(ctx.projectRoot)) {
      if (adr.id === adrRequirement.adr) {
        const it = item(ctx, adr.file, `required by rule ${adrRequirement.ruleId} (${adr.status})`);
        if (it) adrs.push(it);
        seenAdr.add(adr.file);
      }
    }
  }
  for (const adr of listAdrs(ctx.projectRoot)) {
    if (seenAdr.has(adr.file)) continue;
    const hay = `${adr.title} ${adr.file}`.toLowerCase();
    if (keywords.some((k) => hay.includes(k))) {
      const it = item(ctx, adr.file, `title matches task keywords (${adr.status})`);
      if (it) adrs.push(it);
    }
  }

  // 3. Code: the touched files themselves, then same-dir neighbors as pattern reference
  for (const f of files) {
    const it = item(ctx, f, "planned change target");
    if (it) code.push(it);
  }
  for (const f of findNeighbors(ctx, files).slice(0, 6)) {
    const it = item(ctx, f, "same-directory neighbor (pattern reference)");
    if (it) code.push(it);
  }

  // 4. Tests: requirements point at globs; candidates discovered by convention
  const testRequirement = findTestRequirement(ctx, files);
  for (const f of findCandidateTests(ctx, files).slice(0, 8)) {
    const it = item(ctx, f, "covering test file");
    if (it) tests.push(it);
  }

  const guidance = [
    "Read contracts and ADRs before the code; they tell you what the code must satisfy.",
    "Run validate_change with this exact change set before writing files.",
    ...(testRequirement
      ? [`Tests must match: ${testRequirement.testMatch.join(" or ")} (rules: ${testRequirement.ruleIds.join(", ")})`]
      : []),
    ...(adrRequirement ? [`ADR-${adrRequirement.adr} must be accepted before this path changes.`] : []),
  ];

  const all = [...contracts, ...adrs, ...code, ...tests];
  return {
    task: { description: input.description, keywords, files },
    contracts,
    adrs,
    code,
    tests,
    guidance,
    estimatedLines: all.reduce((sum, i) => sum + i.lines, 0),
  };
}
