import { basename, dirname } from "node:path";
import { safeRead, type ProjectContext } from "./config.js";
import { walkSources, extractImports, resolveSpecifier } from "./scanner.js";

/**
 * Pattern discovery: find prior implementations of a concept ("pagination",
 * "retry", "validation") and recommend the repository's established pattern
 * instead of letting agents invent a new one. Ranking combines lexical
 * matches (file names, exports, test names) with usage evidence (how many
 * other modules import it). Purely read-only heuristics.
 */

export interface PatternCandidate {
  file: string;
  /** Where the concept showed up: file name, exported names, test names. */
  matchedIn: ("filename" | "exports" | "test-name")[];
  /** Distinct internal modules importing this file (usage evidence). */
  importers: number;
  /** Test files covering this candidate, by name or directory convention. */
  coveredByTests: string[];
  /** Directory the candidate lives in, for layer context. */
  dir: string;
}

export interface PatternReport {
  concept: string;
  candidates: PatternCandidate[];
  recommendation:
    | {
        file: string;
        reason: string;
        confidence: "high" | "medium" | "low";
        followWith: string[];
      }
    | undefined;
  guidance: string[];
}

const isTestFile = (f: string) => /\.test\.[tj]sx?$/.test(f) || /(^|\/)(test|tests|__tests__)\//.test(f);

/** Crude suffix stem so "pagination" matches "paginateRecords". */
function stem(word: string): string {
  return word.replace(/(ing|ions?|es|s)$/, "");
}

/** Loose containment match on stems, minimum 4 chars after stemming. */
function nameMatches(name: string, keywords: string[]): boolean {
  const ns = stem(name.toLowerCase());
  if (ns.length < 4) return false;
  return keywords.some((k) => {
    const ks = stem(k);
    return ks.length >= 4 && (ns.includes(ks) || ks.includes(ns));
  });
}

function exportedNames(content: string): string[] {
  const names: string[] = [];
  for (const line of content.split("\n")) {
    const m = /^\s*export\s+(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_]+)/.exec(line);
    if (m?.[1]) names.push(m[1]!);
    const re = /^\s*export\s*\{([^}]+)\}/.exec(line);
    if (re?.[1]) {
      for (const part of re[1].split(",")) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) names.push(name);
      }
    }
  }
  return names;
}

/** Build the internal import graph once per run: file -> importer count. */
function buildImportCounts(ctx: ProjectContext): Map<string, number> {
  const counts = new Map<string, number>();
  for (const file of walkSources(ctx.projectRoot)) {
    if (isTestFile(file)) continue;
    const read = safeRead(ctx.projectRoot, file);
    if (!read.found) continue;
    const seen = new Set<string>();
    for (const spec of extractImports(read.content)) {
      const resolved = resolveSpecifier(ctx.projectRoot, file, spec);
      if (resolved && resolved !== file && !seen.has(resolved)) {
        seen.add(resolved);
        counts.set(resolved, (counts.get(resolved) ?? 0) + 1);
      }
    }
  }
  return counts;
}

/** Find prior implementations of a concept and recommend the established one. */
export function findExistingPattern(ctx: ProjectContext, concept: string, limit = 5): PatternReport {
  const keywords = concept.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
  const files = walkSources(ctx.projectRoot);
  const importCounts = buildImportCounts(ctx);

  const candidates: PatternCandidate[] = [];
  for (const file of files) {
    if (isTestFile(file)) continue;
    const lowerFile = basename(file).toLowerCase();
    const nameHit = nameMatches(basename(file).replace(/\.[^.]+$/, ""), keywords) || keywords.some((k) => lowerFile.includes(k));
    const read = safeRead(ctx.projectRoot, file);
    if (!read.found && !nameHit) continue;
    const matchedIn: PatternCandidate["matchedIn"] = [];
    if (nameHit) matchedIn.push("filename");
    const exports = read.found ? exportedNames(read.content) : [];
    const exportHit = exports.some((e) => nameMatches(e, keywords));
    if (exportHit) matchedIn.push("exports");
    if (matchedIn.length === 0) continue;

    const dir = dirname(file);
    const coveredByTests = files.filter(
      (t) =>
        isTestFile(t) &&
        (dirname(t) === dir || basename(t).replace(/\.test\.[tj]sx?$/, "").includes(basename(file).replace(/\.[tj]sx?$/, ""))),
    );
    candidates.push({
      file,
      matchedIn,
      importers: importCounts.get(file) ?? 0,
      coveredByTests,
      dir,
    });
  }

  candidates.sort((a, b) => {
    const score = (c: PatternCandidate) =>
      c.importers * 3 + c.coveredByTests.length * 2 + c.matchedIn.length;
    return score(b) - score(a);
  });
  const top = candidates.slice(0, limit);

  let recommendation: PatternReport["recommendation"];
  if (top.length > 0) {
    const best = top[0]!;
    const multiple = top.filter((c) => c.importers === best.importers).length;
    const confidence: "high" | "medium" | "low" =
      best.importers >= 2 && best.coveredByTests.length > 0
        ? "high"
        : best.importers >= 1 || best.coveredByTests.length > 0
          ? "medium"
          : "low";
    recommendation = {
      file: best.file,
      reason:
        multiple > 1
          ? `Tied on usage (${best.importers} importers); picked for test coverage and match strength. Copy this one's shape.`
          : `${best.importers} internal module(s) import it and ${best.coveredByTests.length} test file(s) cover it. Copy this one's shape.`,
      confidence,
      followWith: [
        `retrieve_relevant_context for ${best.file} and its neighbors`,
        `analyze_impact for the paths you plan to add`,
      ],
    };
  }

  return {
    concept,
    candidates: top,
    recommendation,
    guidance: [
      "Copy the repository's established pattern before inventing a new one.",
      "If two patterns coexist, prefer the more-imported, better-tested one and note the divergence to the team.",
      recommendation
        ? undefined
        : "No established pattern found: you are likely creating one. Put it under the layer your layerDependency rules define and add tests.",
    ].filter((g): g is string => Boolean(g)),
  };
}

