import { safeRead, type ProjectContext } from "../config.js";
import { DOC_PATHS } from "../readers.js";
import { discoverContracts } from "../contracts.js";

export function getProjectIdentity(ctx: ProjectContext) {
  const readme = readReadme(ctx.projectRoot, DOC_PATHS.readme);
  const dirName = ctx.projectRoot.split(/[\\/]/).pop() ?? "unknown";
  const heading = readme ? /^#\s+(.+)$/m.exec(readme)?.[1]?.trim() : undefined;

  return {
    name: heading ?? dirName,
    dirName,
    description: readme?.split("\n").slice(1).map((l) => l.trim()).find((l) => l.length > 0) ?? "",
    ...(readme ? { readme } : {}),
    docInventory: docInventory(ctx),
  };
}

/** Discovered contract inventory: well-known docs, extras in docs/, ADR dir. */
function docInventory(ctx: ProjectContext) {
  return discoverContracts(ctx).map((d) => ({
    path: d.path,
    role: d.role,
    present: d.present,
  }));
}

/** README content, or undefined when absent/unreadable. */
function readReadme(projectRoot: string, path: string): string | undefined {
  const read = safeRead(projectRoot, path);
  return read.found ? read.content : undefined;
}
