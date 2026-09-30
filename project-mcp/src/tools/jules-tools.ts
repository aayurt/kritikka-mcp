import type { ProjectContext } from "../config.js";
import { z } from "zod";
import { prepareJulesTask, validateJulesReady, validateJulesResult } from "../jules.js";

const criteria = z.array(z.string().min(1)).min(1);
const testFiles = z.array(z.string().min(1)).min(1);

/** Pre-dispatch gate: mechanical JULES_READY checklist. */
export function validateJulesReadyTool(ctx: ProjectContext, input: unknown) {
  const parsed = z
    .object({
      acceptanceCriteria: criteria,
      testFiles,
      requireClean: z.boolean().optional(),
    })
    .parse(input);
  return validateJulesReady(ctx, parsed);
}

/** Dispatch package: context bundle + constraints + jules CLI contract. */
export function prepareJulesTaskTool(ctx: ProjectContext, input: unknown) {
  const parsed = z
    .object({
      description: z.string().min(1),
      plannedPaths: z.array(z.string().min(1)).default([]),
      acceptanceCriteria: criteria,
      testFiles,
      budgetLines: z.number().int().positive().max(5000).optional(),
    })
    .parse(input);
  return prepareJulesTask(ctx, parsed);
}

/** Post-dispatch gate: governance over the reported change set. */
export function validateJulesResultTool(ctx: ProjectContext, input: unknown) {
  const parsed = z
    .object({
      branch: z.string().min(1),
      changes: z
        .array(
          z.object({
            path: z.string().min(1),
            changeType: z.enum(["create", "modify", "delete"]),
          }),
        )
        .min(1),
      acceptanceCriteria: z.array(z.string().min(1)).default([]),
      claimedPassingTests: z.array(z.string().min(1)).optional(),
    })
    .parse(input);
  return validateJulesResult(ctx, parsed);
}
