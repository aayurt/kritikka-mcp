import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { safeRead, type ProjectContext } from "./config.js";
import type { Finding } from "./types.js";

/**
 * Heuristic secret detection: pattern scan over repository text files with
 * redacted evidence. Read-only; never exfiltrates the secret itself.
 */

interface SecretPattern {
  id: string;
  severity: RequirementSeverityInput;
  re: RegExp;
  /** Capture group holding the secret; evidence is redacted around it. */
  group?: number;
  hint: string;
}

type RequirementSeverityInput = Finding["severity"];

const PATTERNS: SecretPattern[] = [
  {
    id: "private-key-block",
    severity: "error",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
    hint: "Embedded private key material; move to a secrets manager.",
  },
  {
    id: "aws-access-key",
    severity: "error",
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
    hint: "AWS access key id; rotate and move to environment.",
  },
  {
    id: "generic-api-key-assignment",
    severity: "warning",
    re: /\b(api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["'][^"']{12,}["']/i,
    hint: "Credential-looking assignment; verify it is not a real secret.",
  },
  {
    id: "high-entropy-assignment",
    severity: "warning",
    re: /\b[A-Za-z0-9_]*(?:key|token|secret)[A-Za-z0-9_]*\s*[:=]\s*["'][A-Za-z0-9+/=_-]{32,}["']/,
    hint: "Long credential-shaped string; confirm it is a test fixture.",
  },
  {
    id: "database-url-with-credentials",
    severity: "error",
    re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s"']*:[^\s"'@]+@[^\s"']+/,
    hint: "Connection string embeds credentials; use env vars.",
  },
  {
    id: "slack-bot-token",
    severity: "error",
    re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    hint: "Slack token; rotate and move to environment.",
  },
];

export interface SecretScanResult {
  scannedFiles: number;
  findings: Finding[];
}

/** Redact the middle of a match so evidence cannot leak the secret. */
export function redact(line: string): string {
  return line.length <= 16 ? "*".repeat(line.length) : `${line.slice(0, 8)}…${"*".repeat(6)}…${line.slice(-4)}`;
}

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
  ".toml", ".sh", ".env", ".txt", ".html", ".css", ".sql", ".pem", ".cfg", ".ini", "",
]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "out", "coverage", ".freebuff"]);

function walk(projectRoot: string, dir?: string, out: string[] = []): string[] {
  const absDir = dir ?? projectRoot;
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const abs = join(absDir, entry.name);
    if (entry.isDirectory()) {
      walk(projectRoot, abs, out);
    } else {
      const ext = extnameOf(entry.name);
      if (TEXT_EXTENSIONS.has(ext)) out.push(relative(projectRoot, abs).split(/[\\/]/).join("/"));
    }
  }
  return out;
}

function extnameOf(name: string): string {
  if (name.startsWith(".env")) return ".env";
  const idx = name.lastIndexOf(".");
  if (idx <= 0) return "";
  return name.slice(idx).toLowerCase();
}

export function detectSecrets(ctx: ProjectContext): SecretScanResult {
  const findings: Finding[] = [];
  const files = walk(ctx.projectRoot);
  for (const file of files) {
    const read = safeRead(ctx.projectRoot, file);
    if (!read.found) continue;
    const lines = read.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const p of PATTERNS) {
        if (p.re.test(line)) {
          findings.push({
            ruleId: `secret:${p.id}`,
            severity: p.severity,
            path: file,
            message: `${p.hint} (line ${i + 1}: ${redact(line.trim())})`,
          });
        }
      }
    }
  }
  return { scannedFiles: files.length, findings };
}
