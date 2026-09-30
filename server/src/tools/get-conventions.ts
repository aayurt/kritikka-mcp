import type { ProjectContext } from "../config.js";
import { readDoc, DOC_PATHS } from "../readers.js";
import { toSection } from "./doc-tools.js";

export function getConventions(ctx: ProjectContext) {
  return {
    conventions: toSection(readDoc(ctx.projectRoot, DOC_PATHS.conventions)),
    contributing: toSection(readDoc(ctx.projectRoot, DOC_PATHS.contributing)),
  };
}
