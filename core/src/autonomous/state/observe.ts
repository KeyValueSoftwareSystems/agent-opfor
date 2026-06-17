// Observability: a structured run-event type + deterministic renderers (counts line + lineage
// tree) over the RunLog. The event stream is the foundation a future web view consumes; the
// text renderers make branching legible in the live log + report today. All pure — no I/O here.

import type { RunLog } from "./runLog.js";
import type { Severity } from "../report/types.js";

/** A structured run event (mirrors the prose live log; also written to a .jsonl sink). */
export interface RunEvent {
  at: string;
  type:
    | "thread_created"
    | "turn"
    | "fork"
    | "lead_flagged"
    | "lead_spawned"
    | "lead_dismissed"
    | "finding";
  threadId?: string;
  parentThreadId?: string;
  gen?: number;
  data?: Record<string, unknown>;
}

const SEV_ORDER: Severity[] = ["critical", "high", "medium", "low"];
const SEV_SHORT: Record<Severity, string> = {
  critical: "crit",
  high: "high",
  medium: "med",
  low: "low",
};

/** One-line running tally of the exploration — printed on each structural event. */
export function countsLine(log: RunLog): string {
  const threads = log.threads.size;
  const forks = [...log.threads.values()].filter((t) => t.parentThreadId).length;
  const open = log.leads.filter((l) => l.status === "open").length;
  const spawned = log.leads.filter((l) => l.status === "spawned").length;
  const depth = [...log.threads.values()].reduce((m, t) => Math.max(m, t.gen ?? 0), 0);

  const bySev: Partial<Record<Severity, number>> = {};
  for (const f of log.findings) bySev[f.severity] = (bySev[f.severity] ?? 0) + 1;
  const findingStr = SEV_ORDER.filter((s) => bySev[s])
    .map((s) => `${bySev[s]} ${SEV_SHORT[s]}`)
    .join(", ");

  return (
    `📊 threads ${threads} · forks ${forks} · leads ${log.leads.length} (open ${open}/spawned ${spawned}) · ` +
    `findings ${log.findings.length}${findingStr ? ` (${findingStr})` : ""} · depth ${depth}`
  );
}

/** Render an indented forest from (id, parentId) edges. `labelOf` decorates each node. */
export function renderForest(
  ids: string[],
  parentOf: (id: string) => string | undefined,
  labelOf: (id: string) => string
): string {
  const idSet = new Set(ids);
  const childrenOf = new Map<string, string[]>();
  const roots: string[] = [];
  for (const id of ids) {
    const p = parentOf(id);
    if (p && idSet.has(p)) (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)!).push(id);
    else roots.push(id);
  }
  const lines: string[] = [];
  const walk = (id: string, prefix: string, isRoot: boolean, isLast: boolean): void => {
    const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
    lines.push(prefix + branch + labelOf(id));
    const kids = childrenOf.get(id) ?? [];
    const childPrefix = prefix + (isRoot ? "" : isLast ? "   " : "│  ");
    kids.forEach((k, i) => walk(k, childPrefix, false, i === kids.length - 1));
  };
  roots.forEach((r, i) => walk(r, "", true, i === roots.length - 1));
  return lines.join("\n");
}

/** ASCII lineage tree of all attack threads, marking confirmed-finding threads. */
export function threadTreeText(log: RunLog): string {
  if (log.threads.size === 0) return "(no attack threads)";
  const sevByThread = new Map<string, Severity>();
  for (const f of log.findings) {
    const cur = sevByThread.get(f.threadId);
    if (!cur || SEV_ORDER.indexOf(f.severity) < SEV_ORDER.indexOf(cur)) {
      sevByThread.set(f.threadId, f.severity);
    }
  }
  const ids = [...log.threads.keys()];
  return renderForest(
    ids,
    (id) => log.threads.get(id)?.parentThreadId,
    (id) => {
      const th = log.threads.get(id)!;
      const sev = sevByThread.get(id);
      const mark = sev ? `🔴 ${sev}` : th.turns.length === 0 ? "·" : "🛡";
      return `${id} [${th.vulnClassId ?? "?"}] g${th.gen ?? 0} t${th.turns.length} ${mark}`;
    }
  );
}
