import { Dirent, readdirSync } from "node:fs";
import { extname, join, posix, relative, resolve } from "node:path";
import picomatch from "picomatch";
import { safeRead, type ProjectContext } from "./config.js";
import type { Finding, RequirementSeverity } from "./types.js";

/**
 * Code scanning for layer-dependency analysis: walks the repository (skipping
 * dependencies, dot-dirs, and build output), extracts static import specifiers
 * from JS/TS-family sources, resolves relative specifiers to repo paths, and
 * classifies files against the layer globs declared in a `layerDependency`
 * rule. Import direction is legal only toward deeper layers (higher index).
 */

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".svelte", ".vue"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".freebuff"]);

const IMPORT_RE = /^\s*import\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/;
const EXPORT_FROM_RE = /^\s*export\s+(?:type\s+)?[\s\S]*?\s+from\s+["']([^"']+)["']/;
const CALL_RE = /^\s*(?:const|let|var)\s+.*?=\s*(?:await\s+)?import\(\s*["']([^"']+)["']\s*\)/;

export interface LayerDef {
  name: string;
  globs: string[];
}

/** Repo-relative source files, depth-first, deterministic order. */
export function walkSources(projectRoot: string, dir?: string, out: string[] = []): string[] {
  const absDir = dir ?? projectRoot;
  let entries: Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      walkSources(projectRoot, abs, out);
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      out.push(relative(projectRoot, abs).split(/[\\/]/).join("/"));
    }
  }
  return out;
}

/** Static import specifiers from one file (heuristic, line-based). */
export function extractImports(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const m = IMPORT_RE.exec(line) ?? EXPORT_FROM_RE.exec(line) ?? CALL_RE.exec(line);
    if (m?.[1]) out.push(m[1]);
  }
  return out;
}

const RESOLVE_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js"];

/** Resolve a relative import specifier to a repo-relative path, or undefined. */
export function resolveSpecifier(
  projectRoot: string,
  fromFile: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined; // bare, alias, or node: builtins
  const base = posix.normalize(posix.join(posix.dirname(fromFile), specifier));
  const stripped = base.replace(/\.(mjs|cjs)$/i, ".js");
  for (const suffix of RESOLVE_SUFFIXES) {
    const candidate = `${stripped}${suffix}`;
    if (safeRead(projectRoot, candidate).found) return candidate;
  }
  return undefined;
}

/** Which layer (by index) covers this path, or undefined. */
export function classifyLayer(path: string, layers: LayerDef[]): number | undefined {
  const idx = layers.findIndex((l) => picomatch.isMatch(path, l.globs, { dot: true }));
  return idx === -1 ? undefined : idx;
}

export interface LayerViolation {
  file: string;
  fromLayer: string;
  toLayer: string;
  specifier: string;
  resolved: string | undefined;
}

export interface LayerResult {
  checkedFiles: number;
  checkedImports: number;
  violations: LayerViolation[];
  findings: Finding[];
}

function toFinding(
  ruleId: string,
  severity: RequirementSeverity,
  v: LayerViolation,
): Finding {
  return {
    ruleId,
    severity,
    path: v.file,
    message: `${v.fromLayer} imports ${v.toLayer} ("${v.specifier}"${v.resolved ? ` -> ${v.resolved}` : ""}): inward-only dependency direction violated`,
  };
}

/** Evaluate a single layerDependency rule over the whole repository. */
export function checkLayerDependency(
  ctx: ProjectContext,
  rule: { id: string; layers: LayerDef[]; severity: RequirementSeverity },
): LayerResult {
  const violations: LayerViolation[] = [];
  const files = walkSources(ctx.projectRoot);
  let checkedImports = 0;
  for (const file of files) {
    const fromIdx = classifyLayer(file, rule.layers);
    if (fromIdx === undefined) continue;
    const read = safeRead(ctx.projectRoot, file);
    if (!read.found) continue;
    for (const spec of extractImports(read.content)) {
      checkedImports++;
      const resolved = resolveSpecifier(ctx.projectRoot, file, spec);
      if (!resolved) continue;
      const toIdx = classifyLayer(resolved, rule.layers);
      if (toIdx !== undefined && toIdx < fromIdx) {
        violations.push({
          file,
          fromLayer: rule.layers[fromIdx]!.name,
          toLayer: rule.layers[toIdx]!.name,
          specifier: spec,
          resolved,
        });
      }
    }
  }
  return {
    checkedFiles: files.length,
    checkedImports,
    violations,
    findings: violations.map((v) => toFinding(rule.id, rule.severity, v)),
  };
}
