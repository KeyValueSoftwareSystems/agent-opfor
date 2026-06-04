import {
  getEvaluatorIdSet,
  loadEvaluatorCatalog,
  resolveSuiteEvaluatorIds,
  type EvaluatorMeta,
  type SuiteMeta,
} from "../catalog/loadEvaluatorCatalog.js";

export type { EvaluatorMeta, SuiteMeta };

export async function loadSkillCatalog(): Promise<{
  evaluators: EvaluatorMeta[];
  suites: SuiteMeta[];
}> {
  return loadEvaluatorCatalog("agent");
}

export { getEvaluatorIdSet, resolveSuiteEvaluatorIds };
