import type { ProjectContext } from "../config.js";
import { z } from "zod";
import { buildRelevantContext } from "../context.js";

const inputSchema = z.object({
  description: z.string().min(1),
  files: z.array(z.string().min(1)).default([]),
});

/** Task-scoped minimal context bundle: contracts, ADRs, code neighbors, tests. */
export function retrieveRelevantContext(ctx: ProjectContext, input: unknown) {
  const { description, files } = inputSchema.parse(input);
  return buildRelevantContext(ctx, { description, files });
}
