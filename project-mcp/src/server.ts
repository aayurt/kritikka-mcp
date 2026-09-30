import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ProjectContext } from "./config.js";
import { getProjectIdentity } from "./tools/get-project-identity.js";
import { getArchitectureRules } from "./tools/get-architecture-rules.js";
import { getConventions } from "./tools/get-conventions.js";
import { getCurrentAdrs } from "./tools/get-current-adrs.js";
import { getWorkflow } from "./tools/get-workflow.js";
import { getTestingRequirements } from "./tools/get-testing-requirements.js";
import { changesSchema, validateChange } from "./tools/validate-change.js";
import { boundarySchema, checkRepositoryBoundary } from "./tools/check-repository-boundary.js";
import {
  validateArchitecture,
  detectSecretsTool,
  inspectTask,
  analyzeImpact,
} from "./tools/governance-tools.js";
import { getConstraints, validateContractsTool } from "./tools/contracts-tools.js";
import { retrieveRelevantContext } from "./tools/context-tools.js";
import { compressContextTool } from "./tools/compress-context.js";
import { findExistingPatternTool } from "./tools/find-pattern.js";

const taskSchema = z.object({
  description: z.string().min(1),
  files: z.array(z.string().min(1)).default([]),
});

const readOnly = { readOnlyHint: true } as const;

/**
 * Register all eight tools on an MCP server instance. Each handler receives
 * the already-loaded ProjectContext and returns structured JSON.
 */
export function createServer(ctx: ProjectContext): McpServer {
  const server = new McpServer(
    { name: "project-mcp", version: "0.1.0" },
    { instructions: "Read-only advisor over the repository: docs, ADRs, workflow, and rule-based change validation." },
  );

  server.registerTool(
    "get_project_identity",
    {
      title: "Get project identity",
      description:
        "Project name, one-line description from README.md, and an inventory of the canonical docs with on-disk presence.",
      annotations: readOnly,
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(getProjectIdentity(ctx), null, 2) }] }),
  );

  server.registerTool(
    "get_architecture_rules",
    {
      title: "Get architecture rules",
      description:
        "docs/ARCHITECTURE.md plus AGENTS.md and an index of ADRs with their acceptance status.",
      annotations: readOnly,
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(getArchitectureRules(ctx), null, 2) }] }),
  );

  server.registerTool(
    "get_conventions",
    {
      title: "Get conventions",
      description: "docs/CONVENTIONS.md and CONTRIBUTING.md as structured sections.",
      annotations: readOnly,
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(getConventions(ctx), null, 2) }] }),
  );

  server.registerTool(
    "get_current_adrs",
    {
      title: "Get current ADRs",
      description:
        "ADRs from docs/adr with parsed status. Filter by status (proposed/accepted/superseded) or id; includeContent embeds full text.",
      annotations: readOnly,
      inputSchema: {
        status: z.enum(["proposed", "accepted", "superseded", "template", "unknown"]).optional(),
        id: z.string().regex(/^\d{4}$/).optional(),
        includeContent: z.boolean().optional(),
      },
    },
    async ({ status, id, includeContent }) => ({
      content: [{ type: "text", text: JSON.stringify(getCurrentAdrs(ctx, { status, id, includeContent }), null, 2) }],
    }),
  );

  server.registerTool(
    "get_workflow",
    {
      title: "Get workflow",
      description: "RUNBOOK.md, CONTRIBUTING.md, and docs/DEVELOPMENT.md as structured sections.",
      annotations: readOnly,
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(getWorkflow(ctx), null, 2) }] }),
  );

  server.registerTool(
    "get_testing_requirements",
    {
      title: "Get testing requirements",
      description: "docs/TESTING.md as a structured section.",
      annotations: readOnly,
    },
    async () => ({ content: [{ type: "text", text: JSON.stringify(getTestingRequirements(ctx), null, 2) }] }),
  );

  server.registerTool(
    "validate_change",
    {
      title: "Validate change",
      description:
        "Validate a proposed change set against mcp-rules.json. Errors fail valid:true/false; warnings are advisory. Returns violations, warnings, requiredActions.",
      annotations: readOnly,
      inputSchema: { changes: changesSchema.shape.changes },
    },
    async ({ changes }) => ({
      content: [{ type: "text", text: JSON.stringify(validateChange(ctx, { changes }), null, 2) }],
    }),
  );

  server.registerTool(
    "check_repository_boundary",
    {
      title: "Check repository boundary",
      description:
        "Per-path verdicts: insideRepo, allowed, reason, matchedRule. Rejects absolute paths, ../ traversal, and forbidden directories.",
      annotations: readOnly,
      inputSchema: {
        paths: boundarySchema.shape.paths,
        operation: boundarySchema.shape.operation,
      },
    },
    async ({ paths, operation }) => ({
      content: [{ type: "text", text: JSON.stringify(checkRepositoryBoundary(ctx, { paths, operation }), null, 2) }],
    }),
  );

  server.registerTool(
    "validate_architecture",
    {
      title: "Validate architecture",
      description:
        "Scan the repository's static imports against layerDependency rules: catches outward imports (e.g. domain -> React, UI -> database) mechanically.",
      annotations: readOnly,
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(validateArchitecture(ctx), null, 2) }],
    }),
  );

  server.registerTool(
    "detect_secrets",
    {
      title: "Detect secrets",
      description:
        "Pattern-scan text files for credential-shaped strings (keys, tokens, connection strings). Evidence is redacted.",
      annotations: readOnly,
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(detectSecretsTool(ctx), null, 2) }],
    }),
  );

  server.registerTool(
    "inspect_task",
    {
      title: "Inspect task",
      description:
        "Before coding: which governance rules, ADRs, layers, and test requirements apply to the paths a task plans to touch.",
      annotations: readOnly,
      inputSchema: {
        description: taskSchema.shape.description,
        files: taskSchema.shape.files,
      },
    },
    async ({ description, files }) => ({
      content: [{ type: "text", text: JSON.stringify(inspectTask(ctx, { description, files }), null, 2) }],
    }),
  );

  server.registerTool(
    "analyze_impact",
    {
      title: "Analyze impact",
      description:
        "Static impact analysis for candidate paths: governed rules, layers touched, ADR and test requirements, plus next-step guidance.",
      annotations: readOnly,
      inputSchema: { files: z.array(z.string().min(1)).min(1) },
    },
    async ({ files }) => ({
      content: [{ type: "text", text: JSON.stringify(analyzeImpact(ctx, { files }), null, 2) }],
    }),
  );

  server.registerTool(
    "get_constraints",
    {
      title: "Get constraints",
      description:
        "One-call machine contract: forbidden paths, ADR requirements with statuses, test and doc-update policies, layer direction rules, ADR index, and agent guidance.",
      annotations: readOnly,
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(getConstraints(ctx), null, 2) }],
    }),
  );

  server.registerTool(
    "validate_contracts",
    {
      title: "Validate contracts",
      description:
        "Consistency between prose and machine contracts: rule targets that do not exist, ADR supersede chains that were not flipped, duplicate ids, layers absent from docs/ARCHITECTURE.md.",
      annotations: readOnly,
    },
    async () => ({
      content: [{ type: "text", text: JSON.stringify(validateContractsTool(ctx), null, 2) }],
    }),
  );

  server.registerTool(
    "retrieve_relevant_context",
    {
      title: "Retrieve relevant context",
      description:
        "Minimal context bundle for a task: contracts governing the touched paths, required/keyword-matched ADRs, the target files, same-directory pattern neighbors, and covering tests - with line counts and guidance. Read this before coding.",
      annotations: readOnly,
      inputSchema: {
        description: z.string().min(1),
        files: z.array(z.string().min(1)).default([]),
      },
    },
    async ({ description, files }) => ({
      content: [{ type: "text", text: JSON.stringify(retrieveRelevantContext(ctx, { description, files }), null, 2) }],
    }),
  );

  server.registerTool(
    "compress_context",
    {
      title: "Compress context",
      description:
        "Budget-aware condensation of the relevant-context bundle: signature views for code, section extracts for docs, key inventories for JSON, test-name lists for tests. Deterministic strategies with per-item attribution.",
      annotations: readOnly,
      inputSchema: {
        description: z.string().min(1),
        files: z.array(z.string().min(1)).default([]),
        budgetLines: z.number().int().positive().max(5000).default(400),
      },
    },
    async ({ description, files, budgetLines }) => ({
      content: [{ type: "text", text: JSON.stringify(compressContextTool(ctx, { description, files, budgetLines }), null, 2) }],
    }),
  );

  server.registerTool(
    "find_existing_pattern",
    {
      title: "Find existing pattern",
      description:
        "Discover prior implementations of a concept (e.g. pagination, retry, validation) ranked by usage and test coverage, with a recommendation for the established pattern to copy.",
      annotations: readOnly,
      inputSchema: {
        concept: z.string().min(1),
        limit: z.number().int().positive().max(20).default(5),
      },
    },
    async ({ concept, limit }) => ({
      content: [{ type: "text", text: JSON.stringify(findExistingPatternTool(ctx, { concept, limit }), null, 2) }],
    }),
  );

  return server;
}