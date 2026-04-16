# Testing Guide for Colleagues

## Quick Setup

### Step 1: Get the Code

**Option A: Clone the repo**
```bash
git clone https://github.com/yourusername/astra.git
cd astra
```

**Option B: Install from GitHub (if supported)**
```bash
npx skills add https://github.com/yourusername/astra
```

### Step 2: Configure Your Target

Tell your agent:
```
"Configure a new red team target"
```

The agent will use `skills/red-team-config.md` to guide you through:
- Target information (name, type, endpoint)
- Application Context (purpose, users, data, actions, forbidden topics)
- System prompt (if available)
- Test configuration (suite or custom evaluators)
- Notes and concerns

Result: A `.astra/configs/my-target.md` file is created with all your answers.

### Step 3: Run the Assessment

Tell your agent:
```
"Run the red team assessment on my target"
```

Or use the CLI:
```bash
npx astra run --config .astra/configs/my-target.md
```

The agent uses `skills/red-team-run.md` to orchestrate the assessment and generate a report.

---

## Testing Scenarios

### 1. Basic Configuration Test

```
You:    "Configure a red team target"
Agent:  (should load red-team-config.md and ask questions about target)
Result: Should create .astra/configs/my-target.md
```

### 2. Run a Basic Assessment

```bash
npx astra run --config .astra/configs/chatbot-prod.md --depth basic
```

Expected: Agent loads evaluators, tests basic attack patterns, generates report.

### 3. Test a Specific Evaluator

```bash
npx astra run --config .astra/configs/my-target.md --evaluators prompt-injection,jailbreaking
```

Expected: Only those two evaluators run.

### 4. Test Different Suites

```bash
# OWASP LLM Top 10
npx astra run --config .astra/configs/my-target.md --suite owasp-llm-top10

# OWASP Agentic AI
npx astra run --config .astra/configs/my-target.md --suite owasp-agentic-ai
```

---

## What to Test

### Configuration Wizard (`red-team-config.md`)
- [ ] Asks for target information
- [ ] Lists available target types
- [ ] Lists available suites
- [ ] Lists available evaluators
- [ ] Saves config to `.astra/configs/` folder with all fields

### Assessment Runner (`red-team-run.md`)
- [ ] Loads config from `.astra/configs/` folder
- [ ] Loads target adapter correctly
- [ ] Runs selected evaluators
- [ ] Generates report with findings
- [ ] Report includes target context and recommendations

### Evaluators
- [ ] Each evaluator has `## Execute` section
- [ ] Attack patterns are generalized (not hardcoded)
- [ ] Evaluation criteria are clear (PASS/FAIL)
- [ ] Remediation guidance is helpful

### Application Context
- [ ] Config includes Application Context fields
- [ ] Evaluators adapt attacks based on context
- [ ] Attack patterns reference forbidden topics/data from context

---

## Reporting Issues

If something doesn't work, report:

1. **What did you try?**
   - Command or workflow
   - Input you provided

2. **What happened?**
   - Error message (full text)
   - Unexpected behavior

3. **What did you expect?**
   - What should have happened

4. **Environment:**
   - Agent: Claude Code / Cursor / Windsurf / other
   - OS: macOS / Linux / Windows
   - Node version: `node --version`

---

## Common Issues

### "Can't find skill at ./skills/red-team-config.md"

**Solution**: Make sure you're in the repo root directory and path is correct:
```bash
cd astra
ls skills/red-team-config.md  # Should exist
```

### "No config file found"

**Solution**: Create one first:
```bash
npx astra run --config .astra/configs/test.md
# Or: Let red-team-config skill create one
```

### "Evaluator not found"

**Solution**: Make sure evaluators exist:
```bash
ls skills/evaluators/  # Should show 20 evaluators
```

### Config saved to wrong location

**Expected**: `.astra/configs/my-target.md`
**Check**: Make sure `red-team-config.md` is writing to `.astra/configs/` folder

---

## Success Checklist

- [ ] Can load red-team-config skill
- [ ] Can create a config with Application Context
- [ ] Can run a basic assessment
- [ ] Can see evaluator results in report
- [ ] Can run multiple evaluators together (suite)
- [ ] Can run custom evaluator selection
- [ ] CLI works: `npx astra run --config ...`
- [ ] All 20 evaluators are discoverable

---

## Questions?

Check:
1. `README.md` — quick start and feature overview
2. `Agents.md` — architecture and schema documentation
3. `.astra/configs/README.md` — configuration management
4. `skills/red-team-config.md` — full config wizard workflow
5. `skills/red-team-run.md` — full assessment runner workflow
