import type { ProjectContext } from "../config.js";
import { readDoc, DOC_PATHS } from "../readers.js";
import { toSection } from "./doc-tools.js";

export function getTestingRequirements(ctx: ProjectContext) {
  return {
    testing: toSection(readDoc(ctx.projectRoot, DOC_PATHS.testing)),
  };
}
