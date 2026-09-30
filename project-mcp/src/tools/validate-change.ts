import { z } from "zod";
import type { ProjectContext } from "../config.js";
import { validateChanges } from "../rules.js";

export const changesSchema = z.object({
  changes: z
    .array(
      z.object({
        path: z.string().min(1),
        changeType: z.enum(["create", "modify", "delete"]).default("modify"),
      }),
    )
    .min(1),
});

/** Input is already schema-validated by the SDK at the tool boundary. */
export function validateChange(
  ctx: ProjectContext,
  input: { changes: { path: string; changeType: "create" | "modify" | "delete" }[] },
) {
  const report = validateChanges(ctx, changesSchema.parse(input).changes);
  return {
    valid: report.valid,
    violations: report.violations,
    warnings: report.warnings,
    requiredActions: report.requiredActions,
  };
}
