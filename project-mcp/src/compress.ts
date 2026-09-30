import { safeRead, type ProjectContext } from "./config.js";
import type { ContextItem } from "./context.js";

/**
 * Budget-aware condensation of a relevant-context bundle. Strategies by file
 * kind, no LLM involved:
 * - code      -> signature view: imports plus exported declarations, one line each
 * - docs (.md)-> section extract: headings plus first paragraph of matching sections
 * - JSON      -> top-level key inventory
 * - tests     -> test-case name inventory
 * Always deterministic, always attributed (path + strategy), never silent.
 */

export type CompressStrategy = "signatures" | "sections" | "json-keys" | "test-names" | "truncate" | "verbatim";

export interface CompressedItem extends ContextItem {
  strategy: CompressStrategy;
  /** Condensed content, or verbatim when small enough to fit the budget. */
  excerpt: string;
  originalLines: number;
}

export interface CompressionResult {
  items: CompressedItem[];
  originalLines: number;
  compressedLines: number;
  ratio: number;
  budgetLines: number;
}

const DEFAULT_BUDGET = 400;

/** Extract exported/import surface of a source file, one line each. */
export function signatureView(content: string): string {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t.startsWith("import ") || t.startsWith('import "') || /^export\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\b/.test(t)) {
      const one = t.replace(/\s*\{\s*$/, " {").replace(/\s*;\s*$/, ";");
      out.push(one.length > 160 ? `${one.slice(0, 157)}...` : one);
    }
  }
  return out.slice(0, 60).join("\n");
}

/** Heading + first paragraph per section; sections matching keywords first. */
export function sectionExtract(content: string, keywords: string[] = [], maxSections = 6): string {
  const lines = content.split("\n");
  const sections: { heading: string; body: string[] }[] = [];
  let current: { heading: string; body: string[] } | undefined;
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      if (current) sections.push(current);
      current = { heading: line.trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);

  const scored = sections.map((s) => {
    const hay = s.heading.toLowerCase();
    return { s, score: keywords.filter((k) => hay.includes(k)).length };
  });
  scored.sort((a, b) => b.score - a.score);

  const picked: string[] = [];
  for (const { s, score } of scored.slice(0, maxSections)) {
    const firstPara = s.body
      .join("\n")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !p.startsWith("|"))[0];
    const para = firstPara ? firstPara.split("\n").slice(0, 4).join("\n") : "";
    picked.push(score > 0 ? `${s.heading}\n${para}` : s.heading);
  }
  return picked.join("\n\n");
}

/** Top-level keys of a JSON file. */
export function jsonKeysView(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object") {
      const keys = Object.keys(parsed as Record<string, unknown>);
      return `top-level keys: ${keys.join(", ")}`;
    }
    return "non-object JSON";
  } catch {
    return "unparseable JSON";
  }
}

/** Test case names from a test file. */
export function testNamesView(content: string): string {
  const out: string[] = [];
  for (const line of content.split("\n")) {
    const m = /^\s*(?:it|test)\s*\(\s*["'`](.+?)["'`]/.exec(line);
    if (m?.[1]) out.push(`- ${m[1]}`);
    if (out.length >= 40) break;
  }
  return out.join("\n") || "(no test cases found)";
}

function strategyFor(path: string): CompressStrategy {
  if (/\.(test|spec)\.[tj]sx?$/.test(path) || /(^|\/)(test|tests|__tests__)\//.test(path)) return "test-names";
  if (path.endsWith(".json")) return "json-keys";
  if (/\.(md|markdown)$/.test(path)) return "sections";
  if (/\.[tj]sx?$/.test(path)) return "signatures";
  return "truncate";
}

function condense(path: string, content: string, keywords: string[]): { strategy: CompressStrategy; excerpt: string } {
  const strategy = strategyFor(path);
  switch (strategy) {
    case "signatures":
      return { strategy, excerpt: signatureView(content) };
    case "sections":
      return { strategy, excerpt: sectionExtract(content, keywords) };
    case "json-keys":
      return { strategy, excerpt: jsonKeysView(content) };
    case "test-names":
      return { strategy, excerpt: testNamesView(content) };
    default:
      return { strategy: "truncate", excerpt: content.split("\n").slice(0, 20).join("\n") };
  }
}

/** Compress context items into a line budget. Small items stay verbatim. */
export function compressContext(
  ctx: ProjectContext,
  items: ContextItem[],
  options: { budgetLines?: number; keywords?: string[] } = {},
): CompressionResult {
  const budget = options.budgetLines ?? DEFAULT_BUDGET;
  const keywords = options.keywords ?? [];
  const out: CompressedItem[] = [];
  let used = 0;
  let originalLines = 0;

  // smallest-first so the budget covers breadth before depth
  const sorted = [...items].sort((a, b) => a.lines - b.lines);
  for (const it of sorted) {
    const read = safeRead(ctx.projectRoot, it.path);
    if (!read.found) continue;
    originalLines += it.lines;
    const verbatimLines = it.lines;
    if (used + verbatimLines <= budget) {
      out.push({ ...it, strategy: "verbatim", excerpt: read.content, originalLines: it.lines });
      used += verbatimLines;
      continue;
    }
    const { strategy, excerpt } = condense(it.path, read.content, keywords);
    const excerptLines = excerpt.split("\n").length;
    if (used + excerptLines > budget * 1.25) continue; // hard stop-ish: allow slight overrun
    out.push({ ...it, strategy, excerpt, originalLines: it.lines });
    used += excerptLines;
  }

  return {
    items: out,
    originalLines,
    compressedLines: used,
    ratio: originalLines === 0 ? 1 : Math.round((used / originalLines) * 100) / 100,
    budgetLines: budget,
  };
}
