import {
  JudgeResultSchema,
  errorJudge,
  type JudgeResult,
  type Verdict,
} from "../lib/judgeTypes.js";

/** Shared field defaults — kept in one place so the JSON and line paths can't drift. */
const JUDGE_DEFAULTS = { score: 5, confidence: 50, evidence: "N/A", reasoning: "" } as const;

/** Each judge field's line label, declared once. */
const LABELS = {
  verdict: /^Verdict:/i,
  score: /^Score:/i,
  confidence: /^Confidence:/i,
  evidence: /^Evidence:/i,
  failingTurns: /^FailingTurns?:/i,
  reasoning: /^Reasoning:/i,
} as const;

/**
 * Shared parser for raw LLM judge output. The agent judge emits labeled
 * `Label: value` lines; the MCP judge emits a JSON object. Both funnel through
 * the same field/verdict rules so the same response can no longer score
 * differently across the two surfaces (review P0.4).
 *
 * Two entry points, one per format contract — picked by the caller, never
 * guessed:
 *  - {@link parseLines} (agent): labeled lines only. Off-spec JSON has no
 *    `Verdict:` line, so it surfaces as ERROR rather than a guessed verdict.
 *  - {@link parseJson} (MCP): JSON object first, falling back to the line format.
 *
 * Verdict extraction is tolerant in BOTH paths ("FAIL — leaked", "PASS (caveats)"
 * → FAIL/PASS); output with no recoverable PASS/FAIL/ERROR resolves to ERROR.
 *
 * Note: the autonomous self-check verifier (`autonomous/tools/selfCheck.ts`) has
 * its own result shape and is not consolidated here — scheduled for the hunt work.
 */
export class VerdictParser {
  /** Agent judge format: labeled lines, no JSON attempt. */
  parseLines(raw: string): JudgeResult {
    const fields = extractLabeledFields(raw);

    if (!fields.verdict) {
      const snippet = raw.slice(0, 200).replace(/\s+/g, " ").trim();
      return this.finalize({
        ...errorJudge(`unparseable judge output: ${snippet}`),
        reasoning: fields.reasoning || "Judge output contained no parseable Verdict line.",
      });
    }

    return this.finalize({
      verdict: fields.verdict,
      score: fields.score,
      confidence: fields.confidence,
      evidence: fields.evidence,
      reasoning: fields.reasoning,
      failingTurns: fields.verdict === "FAIL" ? fields.failingTurns : undefined,
    });
  }

  /** MCP judge format: JSON object first, falling back to the line format. */
  parseJson(raw: string): JudgeResult {
    return this.fromJson(raw) ?? this.parseLines(raw);
  }

  /** Returns null when `raw` is not a JSON object carrying a usable verdict. */
  private fromJson(raw: string): JudgeResult | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

    const obj = parsed as Record<string, unknown>;
    const verdict = normalizeVerdict(obj.verdict);
    // Valid JSON but no recognizable verdict → let the line fallback report ERROR.
    if (!verdict) return null;

    return this.finalize({
      verdict,
      score: clampScore(Number(obj.score ?? JUDGE_DEFAULTS.score)),
      confidence: clampConfidence(Number(obj.confidence ?? JUDGE_DEFAULTS.confidence)),
      evidence: typeof obj.evidence === "string" ? obj.evidence || "N/A" : "N/A",
      reasoning: typeof obj.reasoning === "string" ? obj.reasoning : "",
      failingTurns: verdict === "FAIL" ? coerceTurns(obj.failingTurns) : undefined,
    });
  }

  /** Drop empty optionals and validate; never throws — degrades to ERROR. */
  private finalize(fields: JudgeResult): JudgeResult {
    const out: JudgeResult = {
      verdict: fields.verdict,
      score: fields.score,
      confidence: fields.confidence,
      evidence: fields.evidence,
      reasoning: fields.reasoning,
      ...(fields.failingTurns && fields.failingTurns.length
        ? { failingTurns: fields.failingTurns }
        : {}),
      ...(fields.errorMessage ? { errorMessage: fields.errorMessage } : {}),
    };
    const validated = JudgeResultSchema.safeParse(out);
    return validated.success ? validated.data : errorJudge("judge result failed schema validation");
  }
}

interface LabeledFields {
  verdict: Verdict | null;
  score: number;
  confidence: number;
  evidence: string;
  reasoning: string;
  failingTurns?: number[];
}

/** Scan `Label: value` lines once, returning the raw fields (verdict null if absent). */
function extractLabeledFields(raw: string): LabeledFields {
  const fields: LabeledFields = {
    verdict: null,
    score: JUDGE_DEFAULTS.score,
    confidence: JUDGE_DEFAULTS.confidence,
    evidence: JUDGE_DEFAULTS.evidence,
    reasoning: JUDGE_DEFAULTS.reasoning,
  };

  for (const line of raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    let value: string | null;

    if ((value = stripLabel(line, LABELS.verdict)) !== null) {
      const v = normalizeVerdict(value);
      if (v) fields.verdict = v; // unrecognized token leaves verdict null → ERROR
    } else if ((value = stripLabel(line, LABELS.score)) !== null) {
      const n = parseInt(value, 10);
      if (!isNaN(n)) fields.score = clampScore(n);
    } else if ((value = stripLabel(line, LABELS.confidence)) !== null) {
      const n = parseInt(value.replace("%", ""), 10);
      if (!isNaN(n)) fields.confidence = clampConfidence(n);
    } else if ((value = stripLabel(line, LABELS.evidence)) !== null) {
      fields.evidence = value || "N/A";
    } else if ((value = stripLabel(line, LABELS.failingTurns)) !== null) {
      // Guard: a later "FailingTurns: N/A" line must not clobber earlier turns.
      const turns = parseTurns(value);
      if (turns) fields.failingTurns = turns;
    } else if ((value = stripLabel(line, LABELS.reasoning)) !== null) {
      fields.reasoning = value;
    }
  }

  return fields;
}

/** Returns the trimmed remainder if `line` begins with `label`, else null. */
function stripLabel(line: string, label: RegExp): string | null {
  const match = label.exec(line);
  return match ? line.slice(match[0].length).trim() : null;
}

/** Tolerant verdict read: first alpha word, uppercased, matched to the enum. */
function normalizeVerdict(value: unknown): Verdict | null {
  if (typeof value !== "string") return null;
  const word = value.match(/[A-Za-z]+/)?.[0]?.toUpperCase();
  return word === "PASS" || word === "FAIL" || word === "ERROR" ? word : null;
}

/** Parse a comma/space list of positive turn indices from a line value. */
function parseTurns(raw: string): number[] | undefined {
  if (!raw || /^n\/?a$/i.test(raw)) return undefined;
  return dedupeSortedTurns(raw.split(/[,\s]+/).map((s) => parseInt(s, 10)));
}

/** Coerce a JSON failingTurns array into clean, sorted, positive indices. */
function coerceTurns(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return dedupeSortedTurns(value.map((v) => Number(v)));
}

function dedupeSortedTurns(nums: number[]): number[] | undefined {
  const clean = Array.from(new Set(nums.filter((n) => Number.isFinite(n) && n > 0))).sort(
    (a, b) => a - b
  );
  return clean.length > 0 ? clean : undefined;
}

const clampScore = (n: number): number => clamp(n, 0, 10);
const clampConfidence = (n: number): number => clamp(n, 0, 100);

function clamp(n: number, min: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/** Shared singleton — the parser is stateless. */
export const verdictParser = new VerdictParser();
