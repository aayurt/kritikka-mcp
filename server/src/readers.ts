import { readdirSync } from "node:fs";
import { join } from "node:path";
import { safeRead } from "./config.js";
import type { AdrStatus, FileRead, ParsedAdr } from "./types.js";

/** Canonical document paths, used by the doc-serving tools. */
export const DOC_PATHS = {
  readme: "README.md",
  agents: "AGENTS.md",
  contributing: "CONTRIBUTING.md",
  runbook: "RUNBOOK.md",
  architecture: "docs/ARCHITECTURE.md",
  conventions: "docs/CONVENTIONS.md",
  development: "docs/DEVELOPMENT.md",
  testing: "docs/TESTING.md",
  adrDir: "docs/adr",
} as const;

/** Hint to attach when a canonical doc is missing. */
export function docHint(path: string): string {
  return `Expected at repository root: ${path}. Create it or point the server at the right --root.`;
}

/** Read one canonical doc, attaching the standard hint on a miss. */
export function readDoc(projectRoot: string, path: string): FileRead {
  const result = safeRead(projectRoot, path);
  return result.found ? result : { ...result, hint: docHint(path) };
}

const ADR_FILENAME = /^(\d{4})-([a-z0-9-]+)\.md$/;

/** List ADR files (by filename) under docs/adr, sorted by id. */
export function listAdrFiles(projectRoot: string): string[] {
  const dir = join(projectRoot, DOC_PATHS.adrDir);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .map((name) => ({ name, m: ADR_FILENAME.exec(name) }))
    .filter((e): e is { name: string; m: RegExpExecArray } => e.m !== null)
    .sort((a, b) => (a.m[1] ?? "").localeCompare(b.m[1] ?? ""))
    .map((e) => `${DOC_PATHS.adrDir}/${e.name}`);
}

export function parseAdrStatus(content: string): AdrStatus {
  const m = /^---\n([\s\S]*?)\n---/.exec(content);
  if (!m) return "unknown";
  const line = m[1]
    ?.split("\n")
    .find((l) => /^status:/.test(l.trim()));
  if (!line) return "unknown";
  const raw = line.slice(line.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "").toLowerCase();
  if (raw === "proposed" || raw === "accepted" || raw === "superseded" || raw === "template") {
    return raw;
  }
  return "unknown";
}

export function parseAdrTitle(content: string): string | undefined {
  const m = /^#\s+ADR-\d{4}:\s*(.+)$/m.exec(content);
  return m?.[1]?.trim();
}

const FRONTMATTER_BLOCK = /^---\n([\s\S]*?)\n---\n?/;

/** Parse one ADR file into structured form; content is the full file text. */
export function parseAdr(projectRoot: string, path: string): ParsedAdr | { found: false; path: string; hint: string } {
  const read = safeRead(projectRoot, path);
  if (!read.found) return read;
  const content = read.content;
  const fm = FRONTMATTER_BLOCK.exec(content);
  const field = (name: string): string | undefined => {
    if (!fm) return undefined;
    const line = fm[1]
      ?.split("\n")
      .find((l) => l.trim().startsWith(`${name}:`));
    if (!line) return undefined;
    return line.slice(line.indexOf(":") + 1).trim().replace(/^["']|["']$/g, "");
  };
  const idFromName = path.match(/(\d{4})-[a-z0-9-]+\.md$/)?.[1];
  const supersedes = new Set<string>();
  const fmField = field("supersedes");
  if (fmField) {
    for (const m of fmField.matchAll(/\d{4}/g)) supersedes.add(m[0]);
  }
  if (supersedes.size === 0) {
    const body = fm ? content.slice(fm[0].length) : content;
    for (const m of body.matchAll(/[Ss]upersedes?\s+((?:ADR-)?\d{4}(?:\s*,\s*(?:ADR-)?\d{4})*)/g)) {
      for (const id of m[1]?.matchAll(/\d{4}/g) ?? []) supersedes.add(id[0] ?? "");
    }
  }
  return {
    file: path,
    id: field("id") ?? idFromName ?? "0000",
    title: field("title") ?? parseAdrTitle(content) ?? path,
    status: parseAdrStatus(content),
    date: field("date"),
    supersedes: [...supersedes].filter(Boolean),
    content,
  };
}

/** Parse all ADRs; skips files that cannot be read (never throws). */
export function listAdrs(projectRoot: string): ParsedAdr[] {
  const out: ParsedAdr[] = [];
  for (const path of listAdrFiles(projectRoot)) {
    const parsed = parseAdr(projectRoot, path);
    if ("status" in parsed) out.push(parsed);
  }
  return out;
}
