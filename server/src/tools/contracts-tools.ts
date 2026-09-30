import type { ProjectContext } from "../config.js";
import { buildConstraintView, validateContracts } from "../contracts.js";

/** One-call machine-contract view for agents: rules, ADR index, guidance. */
export function getConstraints(ctx: ProjectContext) {
  return buildConstraintView(ctx);
}

/** Cross-contract consistency: machine vs prose, ADR lifecycle, rule sanity. */
export function validateContractsTool(ctx: ProjectContext) {
  return validateContracts(ctx);
}
