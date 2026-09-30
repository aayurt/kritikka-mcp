import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { FileRead } from "./types.js";

/**
 * Schema for `mcp-rules.json` at the repository root. The rule engine
 * (rules.ts) evaluates these; this module only loads and validates them.
 */

const globArray = z.array(z.string().min(1)).min(1);

const baseFields = {
  id: z.string().min(1),
  match: globArray,
  reason: z.string().min(1),
  severity: z.enum(["error", "warning"]).default("error"),
};

const forbiddenRule = z.object({
  ...baseFields,
  type: z.literal("forbidden"),
});

const requireAdrRule = z.object({
  ...baseFields,
  type: z.literal("requireAdr"),
  /** ADR number, e.g. "0001". */
  adr: z.string().regex(/^\d{4}$/),
});

const requireTestRule = z.object({
  ...baseFields,
  type: z.literal("requireTest"),
  /** Globs a test file must match to satisfy the rule. */
  testMatch: globArray,
  /** Source globs exempt from the test requirement. */
  testExempt: z.array(z.string().min(1)).default([]),
});

const requireDocUpdateRule = z.object({
  ...baseFields,
  type: z.literal("requireDocUpdate"),
  /** Doc paths that should be part of the change set. */
  docs: globArray,
});

const ruleSchema = z.discriminatedUnion("type", [
  forbiddenRule,
  requireAdrRule,
  requireTestRule,
  requireDocUpdateRule,
]);

const rulesFileSchema = z.object({
  version: z.literal(1),
  rules: z.array(ruleSchema),
});

export type ProjectRule = z.infer<typeof ruleSchema>;
export type RulesFile = z.infer<typeof rulesFileSchema>;

/** Resolution order for the repository root: --root arg, env, cwd. */
export function resolveProjectRoot(rootArg?: string): string {
  const fromArg = rootArg?.trim();
  if (fromArg) return resolve(fromArg);
  const fromEnv = process.env.PROJECT_MCP_ROOT?.trim();
  if (fromEnv) return resolve(fromEnv);
  return process.cwd();
}

export class RulesValidationError extends Error {
  constructor(
    message: string,
    readonly issues: string[],
  ) {
    super(message);
    this.name = "RulesValidationError";
  }
}

/** Locate and parse `mcp-rules.json` under the project root. */
export function loadRules(projectRoot: string): RulesFile {
  const rulesPath = join(projectRoot, "mcp-rules.json");
  let raw: string;
  try {
    raw = readFileSync(rulesPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new RulesValidationError(`mcp-rules.json not found at ${rulesPath}`, [
        "Create mcp-rules.json at the repository root with a { version: 1, rules: [] } object.",
      ]);
    }
    throw new RulesValidationError(`Cannot read ${rulesPath}: ${code ?? error}`, []);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new RulesValidationError(
      `mcp-rules.json is not valid JSON: ${(error as Error).message}`,
      [],
    );
  }

  const result = rulesFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new RulesValidationError(
      "mcp-rules.json failed schema validation",
      result.error.issues.map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`),
    );
  }

  const ids = new Set<string>();
  for (const rule of result.data.rules) {
    if (ids.has(rule.id)) {
      throw new RulesValidationError(`Duplicate rule id: ${rule.id}`, []);
    }
    ids.add(rule.id);
  }

  return result.data;
}

export interface ProjectContext {
  projectRoot: string;
  rules: RulesFile;
}

/** Resolve the repository root and load its rules into one context. */
export function loadProjectContext(rootArg?: string): ProjectContext {
  const projectRoot = resolveProjectRoot(rootArg);
  const rules = loadRules(projectRoot);
  return { projectRoot, rules };
}

/**
 * Containment-checked read of a single repository-relative file.
 * Rejects absolute paths and any path escaping the root.
 */
export function safeRead(projectRoot: string, relativePath: string): FileRead {
  const rootReal = resolve(projectRoot);
  if (isAbsolute(relativePath)) {
    return {
      found: false,
      path: relativePath,
      hint: "Pass a repository-relative path, not an absolute path.",
    };
  }
  const target = resolve(rootReal, relativePath);
  if (target !== rootReal && !target.startsWith(rootReal + "/")) {
    return {
      found: false,
      path: relativePath,
      hint: "Path escapes the repository root; stay inside the repository.",
    };
  }
  if (!existsSync(target)) {
    return {
      found: false,
      path: relativePath,
      hint: `File not found under ${rootReal}. Check the path or create the file.`,
    };
  }
  try {
    return { found: true, path: relativePath, content: readFileSync(target, "utf8") };
  } catch (error) {
    return {
      found: false,
      path: relativePath,
      hint: `File exists but could not be read: ${(error as Error).message}`,
    };
  }
}
