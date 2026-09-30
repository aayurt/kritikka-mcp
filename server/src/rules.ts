import picomatch from "picomatch";
import type { ProjectContext } from "./config.js";
import { listAdrs, DOC_PATHS } from "./readers.js";
import type {
  BoundaryVerdict,
  Finding,
  ProposedChange,
  RequirementSeverity,
  ValidationReport,
} from "./types.js";

/**
 * Rule engine: matches rule types from `mcp-rules.json` against proposed
 * changes and repository boundaries. Pure functions; no I/O except ADR reads.
 * Input schemas live with their tools (src/tools/); this module evaluates.
 */

const isMatch = (path: string, patterns: string[]): boolean =>
  picomatch.isMatch(path, patterns, { dot: true });

/** Boundary check for one path: containment plus forbidden-rule matching. */
export function checkBoundary(
  ctx: ProjectContext,
  path: string,
  operation: "read" | "write",
): BoundaryVerdict {
  if (path.includes("\0")) {
    return {
      path,
      insideRepo: false,
      allowed: false,
      reason: "Path contains a null byte.",
    };
  }
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    return {
      path,
      insideRepo: false,
      allowed: false,
      reason: "Absolute paths are outside the repository; pass a repository-relative path.",
    };
  }
  const segments = path.split("/");
  if (segments.includes("..")) {
    return {
      path,
      insideRepo: false,
      allowed: false,
      reason: "Path traversal ('..') escapes the repository; pass a repository-relative path.",
    };
  }
  if (segments.some((s) => s === "." || s === "")) {
    return {
      path,
      insideRepo: false,
      allowed: false,
      reason: "Path must be a clean repository-relative path (no '.' or empty segments).",
    };
  }

  const forbidden = ctx.rules.rules.filter((r) => r.type === "forbidden");
  const matched = forbidden.find((r) => isMatch(path, r.match));
  if (matched) {
    return {
      path,
      insideRepo: true,
      allowed: false,
      reason: matched.reason,
      matchedRule: matched.id,
    };
  }

  return {
    path,
    insideRepo: true,
    allowed: true,
    reason: `Inside the repository; no forbidden rule matches this ${operation} path.`,
  };
}

const finding = (ruleId: string, severity: RequirementSeverity, path: string, message: string): Finding => ({
  ruleId,
  severity,
  path,
  message,
});

function checkRequireAdr(ctx: ProjectContext, change: ProposedChange): Finding[] {
  const findings: Finding[] = [];
  for (const rule of ctx.rules.rules) {
    if (rule.type !== "requireAdr") continue;
    if (!isMatch(change.path, rule.match)) continue;
    const adrs = listAdrs(ctx.projectRoot);
    const adr = adrs.find((a) => a.id === rule.adr);
    if (!adr) {
      findings.push(
        finding(
          rule.id,
          rule.severity,
          change.path,
          `Required ADR-${rule.adr} not found in ${DOC_PATHS.adrDir}.`,
        ),
      );
      continue;
    }
    if (adr.status === "superseded") {
      findings.push(
        finding(rule.id, rule.severity, change.path, `ADR-${rule.adr} is superseded; draft a replacement ADR first.`),
      );
      continue;
    }
    if (adr.status !== "accepted") {
      findings.push(
        finding(
          rule.id,
          rule.severity,
          change.path,
          `ADR-${rule.adr} is ${adr.status}; it must be accepted before changes to this path.`,
        ),
      );
    }
  }
  return findings;
}

function checkRequireTest(ctx: ProjectContext, change: ProposedChange, allChanges: ProposedChange[]): Finding[] {
  const findings: Finding[] = [];
  if (change.changeType === "delete") return findings;
  for (const rule of ctx.rules.rules) {
    if (rule.type !== "requireTest") continue;
    if (!isMatch(change.path, rule.match)) continue;
    if (isMatch(change.path, rule.testExempt)) continue;
    const satisfied = allChanges.some(
      (c) => c.changeType !== "delete" && isMatch(c.path, rule.testMatch),
    );
    if (!satisfied) {
      findings.push(
        finding(
          rule.id,
          rule.severity,
          change.path,
          `No test in the change set matches ${rule.testMatch.join(" or ")}.`,
        ),
      );
    }
  }
  return findings;
}

function checkRequireDocUpdate(ctx: ProjectContext, change: ProposedChange, allChanges: ProposedChange[]): Finding[] {
  const findings: Finding[] = [];
  if (change.changeType === "delete") return findings;
  for (const rule of ctx.rules.rules) {
    if (rule.type !== "requireDocUpdate") continue;
    if (!isMatch(change.path, rule.match)) continue;
    const covered = rule.docs.filter((doc) => allChanges.some((c) => c.path === doc && c.changeType !== "delete"));
    for (const doc of rule.docs) {
      if (!covered.includes(doc)) {
        findings.push(
          finding(
            rule.id,
            rule.severity,
            change.path,
            `Include an update to ${doc} in this change set.`,
          ),
        );
      }
    }
  }
  return findings;
}

/**
 * Validate a change set. Paths that fail the boundary check are reported as
 * errors and skipped by path-matching rules. Errors fail `valid`; warnings
 * are advisory. Duplicated paths are validated once.
 */
export function validateChanges(ctx: ProjectContext, changes: ProposedChange[]): ValidationReport {
  const findings: Finding[] = [];

  const seen = new Set<string>();
  const unique: ProposedChange[] = [];
  for (const change of changes) {
    if (seen.has(change.path)) continue;
    seen.add(change.path);
    unique.push(change);
  }

  const inBounds: ProposedChange[] = [];
  for (const change of unique) {
    const verdict = checkBoundary(ctx, change.path, "write");
    if (!verdict.insideRepo || !verdict.allowed) {
      findings.push(finding(verdict.matchedRule ?? "<input>", "error", change.path, verdict.reason));
    } else {
      inBounds.push(change);
    }
  }

  for (const change of inBounds) {
    findings.push(...checkRequireAdr(ctx, change));
    findings.push(...checkRequireTest(ctx, change, inBounds));
    findings.push(...checkRequireDocUpdate(ctx, change, inBounds));
  }

  const violations = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const requiredActions = [...violations, ...warnings].map(
    (f) => `[${f.ruleId}] ${f.path}: ${f.message}`,
  );

  return { valid: violations.length === 0, violations, warnings, requiredActions };
}
