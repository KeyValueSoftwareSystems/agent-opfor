/** recordCost() must correct the estimate in both directions, not just upward. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BudgetGuard } from "../src/autonomous/lib/budget.js";

test("recordCost() corrects the estimate downward, not just upward", () => {
  const budget = new BudgetGuard({ maxThreadTurns: 25, budgetUsd: 2 });

  // Inflate the token-based estimate well past the authoritative cost we're about to record.
  budget.recordTokenUsage(
    {
      inputTokens: 500_000,
      outputTokens: 200_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
    "sonnet"
  );
  assert.ok(budget.spentUsd > 1, "estimate should be inflated before the correction");

  // Authoritative cost comes in lower than the estimate.
  budget.recordCost(0.68);
  assert.equal(budget.spentUsd, 0.68, "authoritative cost must overwrite the estimate downward");
  assert.equal(budget.isOverBudget(), false, "corrected spend is well under the $2 budget");

  // A subsequent token-usage message must not re-inflate spentUsd back up past the correction.
  budget.recordTokenUsage(
    { inputTokens: 1000, outputTokens: 500, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    "sonnet"
  );
  assert.ok(
    budget.spentUsd < 1,
    "a small token-usage increment after a downward correction must not resurrect the stale estimate"
  );
});

test("recordCost() still corrects upward when the authoritative cost is higher", () => {
  const budget = new BudgetGuard({ maxThreadTurns: 25, budgetUsd: 2 });
  budget.recordCost(1.5);
  assert.equal(budget.spentUsd, 1.5);
  budget.recordCost(1.9);
  assert.equal(budget.spentUsd, 1.9);
  assert.equal(budget.isOverBudget(), false);
  budget.recordCost(2.1);
  assert.equal(budget.isOverBudget(), true);
});
