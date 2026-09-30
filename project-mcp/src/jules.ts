import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ProjectContext } from "./config.js";
import { buildRelevantContext } from "./context.js";
import { compressContext } from "./compress.js";
import { validateChanges } from "./rules.js";
import { detectSecrets } from "./secrets.js";

/**
 * Jules dispatch gates: mechanical pre/post checks so the orchestrating agent
 * cannot skip the workflow. Strictly read-only:
 * - git is invoked with an explicit allowlist of read-only subcommands
 * - no network: remote freshness is reported from local remote-tracking refs
 * - dispatch stays external; prepare_jules_task returns the jules CLI contract
 *   for Hermes (or a human) to run
 */

const GIT_ALLOWED = new Set(["status", "branch", "rev-parse", "log", "ls-files"]);

/** Run an allowlisted, read-only git subcommand in the project root. */
export function gitRead(projectRoot: string, sub: string, args: string[] = []): { ok: boolean; out: string } {
  if (!GIT_ALLOWED.has(sub)) return { ok: false, out: `git ${sub} is not allowlisted` };
  try {
    const out = execFileSync("git", [sub, ...args], {
      cwd: projectRoot,
      encoding: "utf8",
      timeout: 5000,
    });
    return { ok: true, out };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, out: err.stdout || err.stderr || err.message || "git failed" };
  }
}

export interface ReadinessCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface ReadinessReport {
  ready: boolean;
  branch: string;
  checks: ReadinessCheck[];
  blockers: string[];
}

/** Full pre-dispatch gate: git, deps, worktree, conflicts, context, criteria, tests. */
export function validateJulesReady(
  ctx: ProjectContext,
  input: { acceptanceCriteria: string[]; testFiles: string[]; requireClean?: boolean | undefined },
): ReadinessReport {
  const requireClean = input.requireClean ?? true;
  const checks: ReadinessCheck[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  // 1. Repository exists and is a git worktree
  const isRepo = gitRead(ctx.projectRoot, "rev-parse", ["--is-inside-work-tree"]);
  add("git-worktree", isRepo.ok && isRepo.out.trim() === "true", isRepo.ok ? `inside work tree: ${isRepo.out.trim()}` : "not a git repository");

  // 2. Branch identity
  const branch = gitRead(ctx.projectRoot, "branch", ["--show-current"]);
  const branchName = branch.ok ? branch.out.trim() : "";
  add("branch-known", branch.ok && branchName.length > 0, branch.ok ? `on '${branchName}'` : "detached HEAD or not a repo");

  // 3. Clean tree / expected changes accounted for
  const status = gitRead(ctx.projectRoot, "status", ["--porcelain"]);
  const changes = status.ok ? status.out.split("\n").filter((l) => l.length > 0) : [];
  if (requireClean) {
    add("git-clean", status.ok && changes.length === 0, status.ok ? (changes.length === 0 ? "working tree clean" : `${changes.length} uncommitted change(s)`) : "status failed");
  } else {
    add("changes-accounted", true, status.ok ? `${changes.length} change(s) present; cleanliness not required for this task` : "status failed");
  }

  // 4. Remote freshness (no network: compare against remote-tracking refs)
  const remotes = gitRead(ctx.projectRoot, "remote", []);
  const hasRemote = remotes.ok && remotes.out.trim().length > 0;
  if (hasRemote && branch.ok && branchName.length > 0) {
    const upstream = gitRead(ctx.projectRoot, "rev-parse", ["--verify", `origin/${branchName}`]);
    const local = gitRead(ctx.projectRoot, "rev-parse", ["HEAD"]);
    if (upstream.ok && local.ok) {
      const same = upstream.out.trim() === local.out.trim();
      add("remote-fresh", same, same ? `HEAD matches origin/${branchName} (per last fetch; run 'git fetch' externally if unsure)` : `HEAD differs from origin/${branchName}: pull or push externally, then re-run this gate`);
    } else {
      add("remote-fresh", false, `no remote-tracking ref origin/${branchName}; push the branch or fetch externally`);
    }
  } else {
    add("remote-fresh", true, "no remote configured; freshness not applicable");
  }

  // 5. Install state valid
  const nm = existsSync(join(ctx.projectRoot, "project-mcp", "node_modules"));
  const lock = existsSync(join(ctx.projectRoot, "project-mcp", "package-lock.json"));
  add("install-valid", nm && lock, nm ? "node_modules present alongside lockfile" : "project-mcp/node_modules missing; run 'npm --prefix project-mcp ci'");

  // 6. No conflicting agent state (merge/rebase/cherry-pick in progress)
  const gitDir = gitRead(ctx.projectRoot, "rev-parse", ["--git-dir"]);
  const gitPath = gitDir.ok ? join(ctx.projectRoot, gitDir.out.trim()) : "";
  const conflictMarkers = [".git", "MERGE_HEAD"].map((p) => existsSync(join(gitPath, p)));
  const inMerge = conflictMarkers.every(Boolean);
  const inRebase = existsSync(join(gitPath, "rebase-merge")) || existsSync(join(gitPath, "rebase-apply"));
  add("no-agent-conflict", !inMerge && !inRebase, inMerge ? "merge in progress" : inRebase ? "rebase in progress" : "no merge/rebase/cherry-pick in progress");

  // 7. Acceptance criteria present
  const criteria = input.acceptanceCriteria.filter((c) => c.trim().length > 0);
  add("acceptance-criteria", criteria.length > 0, criteria.length > 0 ? `${criteria.length} criterion(a) declared` : "no acceptance criteria supplied");

  // 8. Tests identified
  const tests = input.testFiles.filter((t) => t.trim().length > 0);
  add("tests-identified", tests.length > 0, tests.length > 0 ? `${tests.length} test file(s) named` : "no test files named");

  const blockers = checks.filter((c) => !c.pass).map((c) => `${c.name}: ${c.detail}`);
  return {
    ready: blockers.length === 0,
    branch: branchName,
    checks,
    blockers,
  };
}

export interface JulesTaskPackage {
  task: {
    description: string;
    acceptanceCriteria: string[];
    testFiles: string[];
    plannedPaths: string[];
  };
  context: {
    budgetLines: number;
    items: { path: string; why: string; strategy: string; lines: number }[];
    originalLines: number;
    compressedLines: number;
  };
  constraints: {
    validChangeSetRequired: boolean;
    forbiddenPaths: string[];
    adrRequired: string[];
  };
  dispatch: {
    tool: "jules-cli";
    commandTemplate: string;
    runBy: "hermes-or-human";
    note: string;
  };
}

/** Assemble the dispatch package: context bundle + constraints + CLI contract. */
export function prepareJulesTask(
  ctx: ProjectContext,
  input: { description: string; plannedPaths: string[]; acceptanceCriteria: string[]; testFiles: string[]; budgetLines?: number | undefined },
): JulesTaskPackage {
  const bundle = buildRelevantContext(ctx, { description: input.description, files: input.plannedPaths });
  const all = [...bundle.contracts, ...bundle.adrs, ...bundle.code, ...bundle.tests];
  const compressed = compressContext(ctx, all, {
    budgetLines: input.budgetLines ?? 400,
    keywords: bundle.task.keywords,
  });

  const forbiddenPaths: string[] = [];
  const adrRequired: string[] = [];
  for (const rule of ctx.rules.rules) {
    if (rule.type === "forbidden") forbiddenPaths.push(...rule.match);
    if (rule.type === "requireAdr") adrRequired.push(rule.adr);
  }

  const repoDir = ctx.projectRoot.split(/[\\/]/).pop() ?? "REPO";
  return {
    task: {
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria,
      testFiles: input.testFiles,
      plannedPaths: input.plannedPaths,
    },
    context: {
      budgetLines: input.budgetLines ?? 400,
      items: compressed.items.map((i) => ({ path: i.path, why: i.why, strategy: i.strategy, lines: i.originalLines })),
      originalLines: compressed.originalLines,
      compressedLines: compressed.compressedLines,
    },
    constraints: { validChangeSetRequired: true, forbiddenPaths: [...new Set(forbiddenPaths)], adrRequired: [...new Set(adrRequired)] },
    dispatch: {
      tool: "jules-cli",
      commandTemplate: `jules submit --repo ${repoDir} --branch <branch> --task "<description>" --acceptance "<criterion 1>; <criterion 2>"`,
      runBy: "hermes-or-human",
      note: "The MCP does not dispatch. Run this command from Hermes or a human shell, then re-enter the repo and call validate_jules_ready (should still pass) and, after the agent finishes, validate_jules_result with the reported change set.",
    },
  };
}

export interface JulesResultVerdict {
  accepted: boolean;
  branch: string;
  violations: { ruleId: string; severity: string; path: string; message: string }[];
  warnings: { ruleId: string; severity: string; path: string; message: string }[];
  requiredActions: string[];
  secretFindings: number;
  nextSteps: string[];
}

/** Post-dispatch gate: run the reported change set through the rule engine. */
export function validateJulesResult(
  ctx: ProjectContext,
  input: {
    branch: string;
    changes: { path: string; changeType: "create" | "modify" | "delete" }[];
    acceptanceCriteria: string[];
    claimedPassingTests?: string[] | undefined;
  },
): JulesResultVerdict {
  const report = validateChanges(ctx, input.changes);
  const secrets = detectSecrets(ctx);

  const criteria = input.acceptanceCriteria.filter((c) => c.trim().length > 0);
  return {
    accepted: report.valid,
    branch: input.branch,
    violations: report.violations,
    warnings: report.warnings,
    requiredActions: report.requiredActions,
    secretFindings: secrets.findings.filter((f) => f.severity === "error").length,
    nextSteps: [
      report.valid
        ? "Change set passes governance; merge via your normal PR flow."
        : "Fix violations, then re-run validate_jules_result with the updated change set.",
      ...(criteria.length > 0
        ? ["Verify each acceptance criterion against the diff before merging; the MCP checks governance, not intent."]
        : []),
      ...(input.claimedPassingTests && input.claimedPassingTests.length > 0
        ? ["Test claims are agent-reported; CI remains the source of truth."]
        : ["No tests were reported as passing; CI will be the first real verification."]),
    ],
  };
}
