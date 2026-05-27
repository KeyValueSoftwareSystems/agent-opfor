---
name: MCP Report Schema
description: Standard report structure, metrics, and format specifications for Opfor MCP server assessments
---

# MCP Report Schema

Specification for HTML and JSON report generation for MCP server red-teaming. Read this file before generating reports to ensure consistency and prevent hallucination.

---

## Metric Definitions & Calculations

All metrics are derived from attack execution results. Define them as follows:

| Metric                        | Calculation                              | Type           | Example |
| ----------------------------- | ---------------------------------------- | -------------- | ------- |
| **Safety Score**              | (Passed Attacks / Total Attacks) × 100   | percentage     | 76%     |
| **Attack Success Rate**       | (Failed Attacks / Total Attacks) × 100   | percentage     | 24%     |
| **Evaluators Failed**         | Count of evaluators with ≥1 FAIL verdict | integer        | 4       |
| **Attacks Passed**            | Count of attacks with PASS verdict       | integer        | 38      |
| **Pass Rate** (per evaluator) | (Passed / Total) × 100                   | percentage     | 60%     |
| **Fail Rate** (per evaluator) | (Failed / Total) × 100                   | percentage     | 40%     |
| **Avg Score** (per evaluator) | Mean of all attack scores                | decimal (0-10) | 7.2     |

**Important:** Only include PASS and FAIL in score calculations. ERROR results (transport failures, timeouts) are excluded from percentages but reported separately.

---

## JSON Report Structure

**File:** `opfor-mcp-report-<uuid>-<YYYYMMDD-HHMMSS>.json`

```json
{
  "metadata": {
    "reportId": "string (opfor-mcp-<8 hex chars>)",
    "framework": "string (opfor v0.2)",
    "generated": "string (ISO 8601 timestamp)",
    "generatorModel": "string (provider/model)",
    "judgeModel": "string (provider/model)"
  },

  "server": {
    "name": "string (server name from config)",
    "transport": "string (stdio | url)",
    "command": "string (launch command for stdio)",
    "url": "string (endpoint URL for url transport)",
    "suiteId": "string (suite used for assessment)"
  },

  "attackSurface": {
    "tools": [
      {
        "name": "string",
        "description": "string"
      }
    ],
    "resources": [
      {
        "uri": "string",
        "description": "string"
      }
    ]
  },

  "summary": {
    "totalEvaluators": "number",
    "totalAttacks": "number",
    "passed": "number",
    "failed": "number",
    "errors": "number",
    "safetyScore": "number (0-100)",
    "attackSuccessRate": "number (0-100)",
    "criticalFindings": "number",
    "highFindings": "number"
  },

  "evaluatorResults": [
    {
      "id": "string (evaluator ID)",
      "name": "string (evaluator display name)",
      "severity": "string (critical|high|medium|low)",
      "standards": { "owasp-mcp": "MCP01", "atlas": "AML.T0056" },
      "totalAttacks": "number",
      "passed": "number",
      "failed": "number",
      "errors": "number",
      "passRate": "number (0-100)",
      "failRate": "number (0-100)",
      "avgScore": "number (0-10)",
      "attackResults": [
        {
          "attackNumber": "number (1-based index)",
          "toolName": "string (MCP tool or resource attacked)",
          "arguments": "object (JSON arguments sent)",
          "response": "string (full server response)",
          "error": "string | null (transport/tool error if any)",
          "verdict": "string (PASS|FAIL|ERROR)",
          "score": "number (0-10)",
          "confidence": "number (0-100)",
          "evidence": "string (quote from response)",
          "reasoning": "string (1-2 sentences)",
          "turns": [
            {
              "turnIndex": "number (1-based)",
              "toolName": "string",
              "arguments": "object",
              "response": "string",
              "error": "string | null",
              "verdict": "string (PASS|FAIL|ERROR) | null",
              "score": "number | null",
              "reasoning": "string | null"
            }
          ]
        }
      ]
    }
  ],

  "criticalFindings": [
    {
      "rank": "number",
      "evaluator": "string",
      "attackId": "string",
      "toolName": "string",
      "score": "number",
      "description": "string"
    }
  ],

  "highFindings": [
    {
      "rank": "number",
      "evaluator": "string",
      "attackId": "string",
      "toolName": "string",
      "score": "number",
      "description": "string"
    }
  ]
}
```

---

## HTML Report Layout

**File:** `opfor-mcp-report-<uuid>-<YYYYMMDD-HHMMSS>.html`

### Section Order (MANDATORY)

1. **Cover Band** — dark header with branding, title, and meta grid
2. **Executive Summary** — verdict banner, stat cards, narrative
3. **Assessment Scope** — server info, evaluation parameters
4. **Key Findings** — critical and high severity findings (or "no findings" message)
5. **Evaluation Results** — summary table of all evaluators
6. **Detailed Attack Results** — expandable per-evaluator sections with individual attack cards
7. **Footer** — generator credit and report ID

### Cover Band

```
Opfor — MCP Red-team
MCP Server Security Assessment
Automated adversarial evaluation · opfor v0.2 · <date>

Meta grid (3 columns, 2 rows):
  Target Server      | Evaluation Suite    | Assessment Date
  Generator Model    | Judge Model         | Report ID
```

### Executive Summary

- Overall verdict: PASS (no FAIL results) or FAIL (any FAIL exists)
- Risk level: Low Risk (≥80%), Medium Risk (≥60%), High Risk (≥40%), Critical Risk (<40%)
- Stat cards: Safety Score, Attack Success Rate, Attacks Passed, Evaluators Failed
- Narrative: 1-2 sentence summary of findings

### Assessment Scope

Two cards side by side:

- **Target**: Server name (mono), Transport, Total Attacks
- **Evaluation Parameters**: Suite, Generator model (mono), Judge model (mono), Evaluator count

### Key Findings

- Show critical findings first, then high
- Each finding: evaluator name, tool name, score, and 1-line description
- Sort within severity by score descending

### Evaluation Results Table

| #   | Evaluator | Severity | Verdict | Tests | Passed | Failed | Errors\* | Pass Rate | Avg Score |
| --- | --------- | -------- | ------- | ----- | ------ | ------ | -------- | --------- | --------- |

\*Errors column only shown when any evaluator has errors > 0.

**Important:** When the Errors column header is present, EVERY row must emit a `<td>` for it (show "—" if 0). Never skip the cell — it misaligns the table.

### Detailed Attack Results

For each evaluator, an expandable `<details>` section containing individual attack cards:

```
[#01 <attack-id>] [tool-name]                              [PASS/FAIL badge]
  ▸ Arguments (collapsed)
    <pre> JSON formatted arguments </pre>
  ▸ Tool Response (collapsed)
    <pre> response text (truncated to 2000 chars) </pre>
  [Multi-turn breakdown if turns > 0]
    Turn 1 · tool_name · PASS · 8/10
      Arguments: ...
      Response: ...
    Turn 2 · tool_name · FAIL · 3/10
      Arguments: ...
      Response: ...
  [Judge verdict block]
    PASS/FAIL · Score X/10 · Confidence Y%
    Evidence: "quoted text"
    Reasoning: explanation
```

### Color Scheme

| Element           | Color               |
| ----------------- | ------------------- |
| Critical severity | `#DC2626` (red)     |
| High severity     | `#EA580C` (orange)  |
| Medium severity   | `#D97706` (amber)   |
| Low severity      | `#16A34A` (green)   |
| PASS verdict      | `#059669` (emerald) |
| FAIL verdict      | `#DC2626` (red)     |
| ERROR             | `#F59E0B` (amber)   |
| Accent (brand)    | `#f5ad5c` (gold)    |

### CSS Variables

```css
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --surface-2: #f1f5f9;
  --text: #0f172a;
  --text-2: #334155;
  --muted: #64748b;
  --muted-2: #94a3b8;
  --line: #e2e8f0;
  --line-2: #cbd5e1;
  --pass: #059669;
  --pass-bg: #d1fae5;
  --pass-border: #6ee7b7;
  --fail: #dc2626;
  --fail-bg: #fee2e2;
  --fail-border: #fca5a5;
  --accent: #f5ad5c;
}
```

---

## Validation Checklist

Before writing report files, verify:

- [ ] All metrics use the correct formulas (see table above)
- [ ] Safety Score + Attack Success Rate = 100% (when no errors)
- [ ] Evaluators Failed count matches evaluators with ≥1 FAIL verdict
- [ ] Every attack has a verdict (PASS, FAIL, or ERROR)
- [ ] Findings are sorted by score descending within severity
- [ ] JSON report has all required fields (no undefined/null where string expected)
- [ ] HTML table has consistent column count (no missing `<td>` cells)
- [ ] Report ID follows format: `opfor-mcp-<8 hex chars>`
- [ ] Multi-turn attacks show all turns (not just the final one)
- [ ] ERROR attacks are excluded from pass rate / attack success rate denominator
- [ ] Timestamps are valid ISO 8601

---

## Responsive Design

- Desktop (>640px): 3-column cover meta, 2-column scope/findings grids, full-width table
- Mobile (≤640px): 2-column cover meta, single-column grids, horizontal scroll on table
- Print: force color-adjust, avoid page breaks inside cards

---

## File Naming

```
.opfor/reports/
  opfor-mcp-report-<uuid>-<YYYYMMDD-HHMMSS>.html
  opfor-mcp-report-<uuid>-<YYYYMMDD-HHMMSS>.json
```

Both files must share the same UUID and timestamp.
