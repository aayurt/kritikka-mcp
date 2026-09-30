import type { ProjectContext } from "../config.js";
import { checkLayerDependency } from "../scanner.js";
import { detectSecrets } from "../secrets.js";
import { listAdrs } from "../readers.js";
import { findRuleMatches, findAdrRequirement, findTestRequirement } from "../impact.js";
import type { Finding } from "../types.js";

/** Depth of the containing layer rule id prefix, for tool grouping. */
function isLayerRule(rule: { type: string }): boolean {
  return rule.type === "layerDependency";
}

/** Evaluate every layerDependency rule in mcp-rules.json over the repo. */
export function validateArchitecture(ctx: ProjectContext) {
  const layerRules = ctx.rules.rules.filter(isLayerRule);
  const results = layerRules.map((rule) =>
    checkLayerDependency(ctx, rule as { id: string; layers: { name: string; globs: string[] }[]; severity: Finding["severity"] }),
  );
  const findings = results.flatMap((r) => r.findings);
  const violations = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  return {
    valid: violations.length === 0,
    rulesChecked: layerRules.length,
    checkedFiles: results[0]?.checkedFiles ?? 0,
    checkedImports: results.reduce((sum, r) => sum + r.checkedImports, 0),
    violations,
    warnings,
  };
}

export function detectSecretsTool(ctx: ProjectContext) {
  const { scannedFiles, findings } = detectSecrets(ctx);
  const violations = findings.filter((f) => f.severity === "error");
  return {
    scannedFiles,
    clean: violations.length === 0,
    violations,
    warnings: findings.filter((f) => f.severity === "warning"),
  };
}

/** Structured task inspection: which governed paths, ADRs, tests does a task touch? */
export function inspectTask(ctx: ProjectContext, input: { description: string; files?: string[] }) {
  const files = input.files ?? [];
  const matched = findRuleMatches(ctx, files);
  const adrRequirement = findAdrRequirement(ctx, files);
  const testRequirement = findTestRequirement(ctx, files);
  const relevantAdrs = adrRequirement
    ? listAdrs(ctx.projectRoot).filter((a) => a.id === adrRequirement.adr)
    : [];
  return {
    description: input.description,
    touchedPaths: files,
    matchedRules: matched.map((m) => ({
      ruleId: m.rule.id,
      ruleType: m.rule.type,
      severity: m.rule.severity,
      paths: m.paths,
    })),
    adrRequirement,
    relevantAdrs: relevantAdrs.map((a) => ({ id: a.id, title: a.title, status: a.status, file: a.file })),
    testRequirement,
    notes:
      files.length === 0
        ? "No files supplied; pass the paths you plan to touch for impact analysis."
        : undefined,
  };
}

/** Static impact analysis: rules, ADRs, layers, and neighbor modules for touched paths. */
export function analyzeImpact(ctx: ProjectContext, input: { files: string[] }) {
  const matched = findRuleMatches(ctx, input.files);
  const findings: Finding[] = [];
  for (const m of matched) {
    for (const path of m.paths) {
      findings.push({
        ruleId: m.rule.id,
        severity: m.rule.severity,
        path,
        message: `Path is governed by rule "${m.rule.id}" (${m.rule.type}).`,
      });
    }
  }
  const layerRules = ctx.rules.rules.filter(isLayerRule);
  const layersTouched = new Set<string>();
  for (const rule of layerRules) {
    for (const layer of (rule as { layers: { name: string; globs: string[] }[] }).layers) {
      if (input.files.some((f) => layer.globs.some((g) => f.includes(g.replace(/\*\*.*$/, ""))))) {
        layersTouched.add(layer.name);
      }
    }
  }
  return {
    files: input.files,
    governedPaths: findings,
    layersTouched: [...layersTouched],
    adrRequirement: findAdrRequirement(ctx, input.files),
    testRequirement: findTestRequirement(ctx, input.files),
    guidance:
      "Run validate_change on this exact change set before writing files; ADR-governed paths need accepted ADRs first.",
  };
}
