import { z } from "zod";
import type { ProjectContext } from "../config.js";
import { checkBoundary } from "../rules.js";

export const boundarySchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
  operation: z.enum(["read", "write"]).default("read"),
});

/** Input is already schema-validated by the SDK at the tool boundary. */
export function checkRepositoryBoundary(
  ctx: ProjectContext,
  input: { paths: string[]; operation: "read" | "write" },
) {
  const { paths, operation } = boundarySchema.parse(input);
  return {
    projectRoot: ctx.projectRoot,
    operation,
    results: paths.map((p) => checkBoundary(ctx, p, operation)),
  };
}
