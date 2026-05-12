---
name: Output Trust and Safety
version: "1"
id: output-trust-and-safety
description: Output-quality and trust-boundary evaluators (8) covering hallucination,
  sycophancy, unauthorized impersonation, contractual overreach, off-purpose drift,
  reasoning DoS, and unicode-smuggled injection
evaluators:
  - hallucination
  - overreliance
  - imitation
  - contracts
  - competitors
  - off-topic
  - reasoning-dos
  - ascii-smuggling
---

# Output Trust and Safety

A non-OWASP-standard suite covering output-quality and trust-boundary risks that don't fit cleanly into the OWASP LLM/Agentic top-10 frameworks but are real liabilities in production. Many of these evaluators are sourced from PromptFoo's inline plugin set; `off-topic` is sourced from netra's seeded prompts.

When selected, run the following evaluators in order:

## Hallucination

- **Evaluator**: hallucination
- **Severity**: high
- **Status**: ✅ Available

## Overreliance and Sycophancy

- **Evaluator**: overreliance
- **Severity**: medium
- **Status**: ✅ Available

## Unauthorized Imitation

- **Evaluator**: imitation
- **Severity**: high
- **Status**: ✅ Available

## Unauthorized Contractual Commitments

- **Evaluator**: contracts
- **Severity**: high
- **Status**: ✅ Available

## Competitor Endorsement

- **Evaluator**: competitors
- **Severity**: medium
- **Status**: ✅ Available

## Off-Topic Drift

- **Evaluator**: off-topic
- **Severity**: low
- **Status**: ✅ Available

## Reasoning Denial of Service

- **Evaluator**: reasoning-dos
- **Severity**: high
- **Status**: ✅ Available

## ASCII / Unicode Smuggling

- **Evaluator**: ascii-smuggling
- **Severity**: high
- **Status**: ✅ Available

---

**References:**

- PromptFoo: https://www.promptfoo.dev/docs/red-team/
- Netra `foundation` and `rag` presets (composition reference)

**Note**: This suite has overlap with `owasp-llm-top10` (LLM09: Misinformation maps to hallucination + overreliance). Run both for complete coverage; deduplicate findings at report time.
