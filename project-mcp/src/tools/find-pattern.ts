import type { ProjectContext } from "../config.js";
import { z } from "zod";
import { findExistingPattern } from "../patterns.js";

const inputSchema = z.object({
  concept: z.string().min(1),
  limit: z.number().int().positive().max(20).default(5),
});

/** Discover prior implementations of a concept; recommend the established pattern. */
export function findExistingPatternTool(ctx: ProjectContext, input: unknown) {
  const { concept, limit } = inputSchema.parse(input);
  return findExistingPattern(ctx, concept, limit);
}
