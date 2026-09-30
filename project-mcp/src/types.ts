/** Severity of a rule finding. */
export type RequirementSeverity = "error" | "warning";

/** How a change was made. */
export type ChangeType = "create" | "modify" | "delete";

/** One proposed change, as supplied to validate_change. */
export interface ProposedChange {
  path: string;
  changeType: ChangeType;
}

/** A single validation finding. */
export interface Finding {
  ruleId: string;
  severity: RequirementSeverity;
  path: string;
  message: string;
}

/** Result of validating a change set against the rule engine. */
export interface ValidationReport {
  valid: boolean;
  violations: Finding[];
  warnings: Finding[];
  requiredActions: string[];
}

/** Outcome of a boundary check for one path. */
export interface BoundaryVerdict {
  path: string;
  insideRepo: boolean;
  allowed: boolean;
  reason: string;
  matchedRule?: string;
}

/** A file read that either succeeded or explains its miss. */
export type FileRead =
  | { found: true; path: string; content: string }
  | { found: false; path: string; hint: string };

/** Frontmatter plus body of a parsed ADR; `date` is omitted when unknown. */
export interface ParsedAdr {
  file: string;
  id: string;
  title: string;
  status: AdrStatus;
  date?: string | undefined;
  content: string;
}

export type AdrStatus = "proposed" | "accepted" | "superseded" | "template" | "unknown";
