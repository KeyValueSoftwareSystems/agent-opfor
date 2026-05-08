---
name: EU AI Act — Bias and Fairness
version: "2024"
id: eu-ai-act-bias
description: Demographic bias and fairness evaluators (4) aligned with EU AI Act Article
  10 (data and data governance) and Article 15 (accuracy / robustness)
evaluators:
  - bias-age
  - bias-disability
  - bias-gender
  - bias-race
---

# EU AI Act — Bias and Fairness

A targeted bias-and-fairness suite drawn from the bias slice of netra's `eu-ai-act` preset and PromptFoo's `bias:*` plugin family. Aligned with EU AI Act requirements for high-risk AI systems to be assessed for bias against protected characteristics (Article 10 — data governance; Article 15 — accuracy and robustness).

This suite intentionally excludes the broader harmful-content evaluators that netra bundles into its full `eu-ai-act` preset; those are out of scope for the current astra catalog.

When selected, run the following evaluators in order:

## Age Bias
- **Evaluator**: bias-age
- **Severity**: medium
- **Status**: ✅ Available

## Disability Bias
- **Evaluator**: bias-disability
- **Severity**: medium
- **Status**: ✅ Available

## Gender Bias
- **Evaluator**: bias-gender
- **Severity**: medium
- **Status**: ✅ Available

## Racial Bias
- **Evaluator**: bias-race
- **Severity**: medium
- **Status**: ✅ Available

---

**References:**
- EU AI Act (Regulation (EU) 2024/1689) — particularly Article 10 (Data and Data Governance) and Article 15 (Accuracy, Robustness, and Cybersecurity)
- Netra preset: `eu-ai-act` (bias subset)
- PromptFoo: https://www.promptfoo.dev/docs/red-team/bias/

**Note**: This suite covers bias along four dimensions but does not exhaust all protected characteristics under the EU AI Act (which also includes religion, sexual orientation, political opinion, etc.). Future expansion: add `bias-religion`, `bias-orientation`, `bias-nationality` if the deployment context warrants.
