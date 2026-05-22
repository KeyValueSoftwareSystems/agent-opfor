/** @type {Record<string, unknown> | null} */
let cachedAttackCatalog = null;

export async function loadAttackCatalog() {
  if (cachedAttackCatalog) return cachedAttackCatalog;
  const url = chrome.runtime.getURL("catalog.json");
  const resp = await fetch(url);
  if (!resp.ok)
    throw new Error(
      `Failed to load catalog.json (${resp.status}). Run: node extension/scripts/build-catalog.mjs`
    );
  cachedAttackCatalog = await resp.json();
  return cachedAttackCatalog;
}

export function evaluatorFromCatalog(catalog, evaluatorId) {
  const list = catalog?.evaluators;
  if (!Array.isArray(list)) return null;
  return list.find((e) => e?.id === evaluatorId) || null;
}

export function assertEvaluatorInSuite(catalog, suiteId, evaluatorId) {
  if (suiteId === "all-evaluators") {
    const exists = catalog?.evaluators?.some((e) => e.id === evaluatorId);
    if (!exists) throw new Error(`Unknown evaluator: ${evaluatorId}`);
    return;
  }
  const suite = catalog?.suites?.find((s) => s.id === suiteId);
  if (!suite) throw new Error(`Unknown suite: ${suiteId}`);
  if (!suite.evaluatorIds?.includes(evaluatorId)) {
    throw new Error(`Evaluator "${evaluatorId}" is not in suite "${suiteId}".`);
  }
}
