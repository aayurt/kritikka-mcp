import type { ProjectContext } from "../config.js";
import { listAdrs, DOC_PATHS } from "../readers.js";
import type { AdrStatus } from "../types.js";

export function getCurrentAdrs(
  ctx: ProjectContext,
  input: { status?: AdrStatus | undefined; includeContent?: boolean | undefined; id?: string | undefined },
) {
  let adrs = listAdrs(ctx.projectRoot);

  if (input.id) {
    adrs = adrs.filter((a) => a.id === input.id);
    if (adrs.length === 0) {
      return {
        found: false as const,
        hint: `No ADR with id ${input.id} in ${DOC_PATHS.adrDir}. Use the four-digit number, e.g. "0001".`,
      };
    }
  }
  if (input.status) {
    adrs = adrs.filter((a) => a.status === input.status);
  }

  return {
    found: adrs.length > 0,
    count: adrs.length,
    directory: DOC_PATHS.adrDir,
    adrs: adrs.map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      date: a.date,
      file: a.file,
      ...(input.includeContent ? { content: a.content } : {}),
    })),
  };
}
