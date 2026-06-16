import type { UiFinding } from "../types";

interface Props {
  findings: UiFinding[];
  selectedThreadId?: string;
  onSelectThread: (threadId: string) => void;
}

const SEV_ORDER = ["critical", "high", "medium", "low"];

export function FindingsPanel({ findings, selectedThreadId, onSelectThread }: Props) {
  const sorted = [...findings].sort(
    (a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity)
  );

  return (
    <div className="findings-panel">
      <div className="findings-header">
        <h2>Findings</h2>
        {findings.length > 0 && <span className="findings-count">{findings.length}</span>}
      </div>
      <div className="findings-list">
        {sorted.length === 0 ? (
          <div className="findings-empty">
            <div className="empty-icon">🛡️</div>
            <p>No vulnerabilities found yet</p>
          </div>
        ) : (
          sorted.map((f) => (
            <button
              key={f.findingId}
              type="button"
              className={`finding ${selectedThreadId === f.threadId ? "selected" : ""}`}
              onClick={() => onSelectThread(f.threadId)}
            >
              <div className="finding-header">
                <span className={`sev sev-${f.severity}`}>{f.severity}</span>
                <span className="finding-confidence">{f.confidence}%</span>
              </div>
              <div className="finding-name">{f.name}</div>
              <div className="finding-type">
                {f.vulnClassId} · {f.strategy}
              </div>
              <div className="finding-evidence">{f.evidence}</div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
