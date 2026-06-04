import {
  getEvaluatorIdSet,
  loadEvaluatorCatalog,
  type EvaluatorMeta,
  type SuiteMeta,
} from "./loadEvaluatorCatalog.js";
import { getSkillOpforSetupRoot } from "../config/evaluatorsLayout.js";

export type { EvaluatorMeta, SuiteMeta };

/** @deprecated Use `getEvaluatorsDir("mcp")` from `evaluatorsLayout.js`. */
export function getCatalogRoot(): string {
  return getSkillOpforSetupRoot("mcp");
}

export async function loadCatalog(): Promise<{
  evaluators: EvaluatorMeta[];
  suites: SuiteMeta[];
}> {
  return loadEvaluatorCatalog("mcp");
}

export { getEvaluatorIdSet };
