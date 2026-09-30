import picomatch from "picomatch";
import type { ProjectContext } from "./config.js";
import type { ProjectRule } from "./config.js";

/**
 * Impact analysis: which governance applies to a candidate set of paths,
 * reused by inspect_task and analyze_impact. Pure matching; no I/O except
 * through the ADR lookup the caller performs.
 */

const isMatch = (path: string, patterns: string[]): boolean =>
  picomatch.isMatch(path, patterns, { dot: true });

export interface RuleMatch {
  rule: ProjectRule;
  paths: string[];
}

/** Rules scoped by path globs (all types except layerDependency). */
type PathScopedRule = Extract<ProjectRule, { match: string[] }>;

/** All path-scoped rules whose match globs cover at least one candidate path. */
export function findRuleMatches(ctx: ProjectContext, paths: string[]): RuleMatch[] {
  const out: RuleMatch[] = [];
  for (const rule of ctx.rules.rules) {
    if (!("match" in rule)) continue; // layerDependency rules are repo-wide
    const scoped = rule as PathScopedRule;
    const hit = paths.filter((p) => isMatch(p, scoped.match));
    if (hit.length > 0) out.push({ rule: scoped, paths: hit });
  }
  return out;
}

export interface AdrRequirement {
  ruleId: string;
  adr: string;
  paths: string[];
}

/** The strongest ADR requirement applying to the candidate paths, if any. */
export function findAdrRequirement(ctx: ProjectContext, paths: string[]): AdrRequirement | undefined {
  for (const rule of ctx.rules.rules) {
    if (rule.type !== "requireAdr") continue;
    const hit = paths.filter((p) => isMatch(p, rule.match));
    if (hit.length > 0) return { ruleId: rule.id, adr: rule.adr, paths: hit };
  }
  return undefined;
}

export interface TestRequirement {
  ruleIds: string[];
  testMatch: string[];
  paths: string[];
}

/** Test requirements covering the candidate paths (union of matching rules). */
export function findTestRequirement(ctx: ProjectContext, paths: string[]): TestRequirement | undefined {
  const ruleIds: string[] = [];
  const testMatch: string[] = [];
  const covered: string[] = [];
  for (const rule of ctx.rules.rules) {
    if (rule.type !== "requireTest") continue;
    const hit = paths.filter((p) => isMatch(p, rule.match) && !isMatch(p, rule.testExempt));
    if (hit.length > 0) {
      ruleIds.push(rule.id);
      testMatch.push(...rule.testMatch);
      covered.push(...hit);
    }
  }
  return ruleIds.length > 0 ? { ruleIds, testMatch: [...new Set(testMatch)], paths: covered } : undefined;
}
