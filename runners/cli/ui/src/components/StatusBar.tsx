import type { UiRunState } from "../types";
import wordmark from "../assets/opfor-wordmark.svg";

interface Props {
  state: UiRunState;
  connected: boolean;
  outcome?: string;
}

export function StatusBar({ state, connected, outcome }: Props) {
  const running = state.phase === "running" || (state.phase === "boot" && !outcome);
  const cost = state.totalCostUsd ?? 0;
  const budget = state.budgetUsd;

  return (
    <header className="header">
      <div className="header-left">
        <img className="header-logo" src={wordmark} alt="Agent OPFOR" />
        <span className={`status ${running ? "running" : "done"}`}>
          <span className={`dot ${connected ? "live" : ""}`} />
          {running ? "Running" : (outcome ?? "Complete")}
        </span>
        {state.demo && <span className="demo-tag">Demo</span>}
      </div>
      <div className="header-center">
        <span className="target">{state.targetName || "—"}</span>
      </div>
      <div className="header-right">
        <span className="cost">
          ${cost.toFixed(2)}
          {budget ? <span className="budget"> / ${budget.toFixed(2)}</span> : null}
        </span>
      </div>
    </header>
  );
}
