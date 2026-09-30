import type { ProjectContext } from "../config.js";
import { readDoc, DOC_PATHS } from "../readers.js";
import { toSection } from "./doc-tools.js";

export function getWorkflow(ctx: ProjectContext) {
  return {
    runbook: toSection(readDoc(ctx.projectRoot, DOC_PATHS.runbook)),
    contributing: toSection(readDoc(ctx.projectRoot, DOC_PATHS.contributing)),
    development: toSection(readDoc(ctx.projectRoot, DOC_PATHS.development)),
  };
}
