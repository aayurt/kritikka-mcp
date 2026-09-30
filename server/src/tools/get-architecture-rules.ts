import type { ProjectContext } from "../config.js";
import { readDoc, listAdrs, DOC_PATHS } from "../readers.js";
import { toSection } from "./doc-tools.js";

export function getArchitectureRules(ctx: ProjectContext) {
  const architecture = readDoc(ctx.projectRoot, DOC_PATHS.architecture);
  const agents = readDoc(ctx.projectRoot, DOC_PATHS.agents);
  const adrIndex = listAdrs(ctx.projectRoot).map((a) => ({
    id: a.id,
    title: a.title,
    status: a.status,
    file: a.file,
  }));
  return {
    architecture: toSection(architecture),
    agents: toSection(agents),
    adrIndex,
  };
}
