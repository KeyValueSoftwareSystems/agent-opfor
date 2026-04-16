---
name: red-team-config
description: >
  Configure a target for AI red team assessment. Use when the user wants to
  set up a new target, configure what to test, or create a astra.config.md.
  Trigger when they say "configure", "set up", "create config", or start a
  red team for the first time without a config.
---

# Red Team Configuration

Configure a target for red team assessment. Collect the following from the user interactively.

## 1. Target Information

Ask the user about their target:
- **Name** — what do they call it? (e.g., "Support Bot")
- **Type** — what kind of system? (`chatbot`, `api`, `agent`, `rag-pipeline`)
- **Endpoint** — how to reach it? (URL, `local`, or a description)
- **Model** — what model powers it, if known? (optional)

## 2. Target Type

Ask the user which integration method they want to use. Discover available options by scanning `../red-team-run/targets/` for `.md` files. Default to `http-endpoint`.

## 3. Application Context

Understanding the target's purpose and constraints helps evaluators craft more effective, targeted attacks.

Ask the user for:

- **What does this agent do?** — Primary purpose and scope of the system (e.g., "customer support for e-commerce", "internal research assistant")
- **Types of users who interact with it** — User categories and their access levels (e.g., "logged-in customers, guest users, support agents with elevated access")
- **Types of sensitive data it handles** — What data the system processes (e.g., "order history, payment methods, personal addresses, medical records")
- **Critical or dangerous actions it can perform** — High-risk operations (e.g., "process refunds, delete accounts, authorize expenses")
- **Topics it should never discuss** — Forbidden subjects and restricted information (e.g., "competitor pricing, internal financials, unreleased products")

*Note: This is optional but dramatically improves attack quality. Evaluators use this context to craft white-box attacks that specifically target the guardrails and scope boundaries the user defines.*

## 4. System Prompt (if available)

Ask the user if they can share the target's system prompt. This is optional but extremely valuable — evaluators can craft attacks that specifically target the guardrails and constraints defined in the system prompt.

## 5. Assessment Scope: Suite or Custom Evaluators

Ask the user how they want to define what to test:

### Option A: Use a Suite

Discover available suites by scanning `../red-team-run/suites/` for `.md` files and reading the `name` frontmatter from each. Present them with descriptions.

If user chooses a suite, confirm which evaluators it covers.

### Option B: Custom Evaluator Selection

Discover available evaluators by scanning `../red-team-run/evaluators/` for `.md` files and reading the `name`, `severity`, and `description` frontmatter from each. Present them grouped by severity.

Ask user to select which evaluators to run. Multiple selections allowed.

## 6. Depth (if applicable)

Ask:
- **basic** — quick scan with basic-level attacks only
- **intermediate** — moderate difficulty attacks testing defense mechanisms
- **advanced** — advanced attack patterns attempting to bypass defenses

## 7. Additional Notes

Ask the user for any additional context about the target that might help crafting attacks — specific concerns, known issues, business context, risk tolerance, etc. This free-form context helps generate smarter, more targeted attacks.

## 8. Write Config

Write the config to `.astra/configs/<name>.md` (where `<name>` is derived from the target name, lowercase with hyphens). A fully-filled example is at `../../astra.config.md.example` for reference.

The config format:

```markdown
# Red Team Configuration

## Target Information

**Name:** <user input>
**Type:** <user selection (chatbot, api, agent, rag-pipeline)>
**Target Type:** <user selection from adapters (http-endpoint, custom-function)>
**Endpoint:** <user input (URL, localhost, or description)>
**Model:** <user input or "unknown">

## Application Context

### What does this agent do?
<user's description of purpose and scope>

### Types of users who interact with it
<user's list of user types and access levels>

### Types of sensitive data it handles
<user's list of data types>

### Critical or dangerous actions it can perform
<user's list of risky operations>

### Topics it should never discuss
<user's list of forbidden subjects>

## System Prompt

<user's system prompt if provided, else "Not provided">

## Test Configuration

**Mode:** suite | custom
**Suite:** <selected suite name (if Mode=suite)>
**Evaluators:** <comma-separated list (if Mode=custom)>
**Depth:** basic | intermediate | advanced

## Notes

<user's free-form context and concerns>

<!--
Config ID: <generated ID>
Created: <ISO 8601 timestamp>
-->
```

**If a config already exists for this target**, ask the user if they want to:
- Overwrite the existing config
- Create a separate config with a different name (e.g., `.astra/configs/chatbot-v2.md`)
- Exit without saving

## 9. Confirm

Show the user a summary:
- Target: <name> (<type>)
- Assessment: <suite or custom evaluators> at <depth> level
- Config saved to: `.astra/configs/<filename>`
- Next step: `npx astra run --config .astra/configs/<filename>`

Suggest they can also:
- View/edit the config at `.astra/configs/<filename>`
- Store multiple configs in the `.astra/configs/` folder
- See examples at `.astra/configs/README.md`
