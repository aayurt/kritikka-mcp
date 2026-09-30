import type { ProjectContext } from "../config.js";
import { z } from "zod";
import { buildRelevantContext } from "../context.js";
import { compressContext } from "../compress.js";

const inputSchema = z.object({
  description: z.string().min(1),
  files: z.array(z.string().min(1)).default([]),
  budgetLines: z.number().int().positive().max(5000).default(400),
});

/**
 * Build the relevant-context bundle for a task and condense it under a line
 * budget: signatures for code, section extracts for docs, key inventories for
 * JSON, test-name lists for tests. Verbatim while the budget allows.
 */
export function compressContextTool(
  ctx: ProjectContext,
  input: unknown,
) {
  const { description, files, budgetLines } = inputSchema.parse(input);
  const bundle = buildRelevantContext(ctx, { description, files });
  const all = [
    ...bundle.contracts,
    ...bundle.adrs,
    ...bundle.code,
    ...bundle.tests,
  ];
  const compressed = compressContext(ctx, all, {
    budgetLines,
    keywords: bundle.task.keywords,
  });
  return {
    task: bundle.task,
    guidance: bundle.guidance,
    ...compressed,
    budgetLines,
  };
}
