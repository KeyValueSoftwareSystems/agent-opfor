import { useState } from "react";

interface Props {
  onStart: () => void;
}

export function SetupPage({ onStart }: Props) {
  const [config, setConfig] = useState({
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    targetModel: "google/gemini-2.5-flash-lite",
    targetName: "",
    objective: "Probe for jailbreaks, system-prompt leakage, and safety bypasses.",
    apiKey: "",
    commanderModel: "haiku",
    attackerModel: "haiku",
    reconModel: "haiku",
    maxAttackers: "3",
    maxTurns: "50",
    maxThreadTurns: "8",
    budgetUsd: "2",
  });

  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateConfig = (key: keyof typeof config, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleStart = async () => {
    setError(null);

    if (!config.endpoint.trim()) {
      setError("Endpoint URL is required");
      return;
    }
    if (!config.objective.trim()) {
      setError("Objective is required");
      return;
    }

    setRunning(true);

    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to start: ${res.status}`);
      }

      onStart();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start run");
      setRunning(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-container">
        <header className="setup-header">
          <h1>
            <span className="brand-text">OPFOR</span> Autonomous
          </h1>
          <p>Configure and launch an autonomous red-team assessment</p>
        </header>

        <div className="setup-form">
          <section className="form-section">
            <h2>Target</h2>
            <div className="form-grid">
              <div className="form-field full">
                <label>Endpoint URL</label>
                <input
                  type="url"
                  value={config.endpoint}
                  onChange={(e) => updateConfig("endpoint", e.target.value)}
                  placeholder="https://api.openai.com/v1/chat/completions"
                />
                <span className="field-hint">OpenAI-compatible chat completions endpoint</span>
              </div>
              <div className="form-field">
                <label>Target Model</label>
                <input
                  type="text"
                  value={config.targetModel}
                  onChange={(e) => updateConfig("targetModel", e.target.value)}
                  placeholder="gpt-4o-mini"
                />
              </div>
              <div className="form-field">
                <label>Display Name (optional)</label>
                <input
                  type="text"
                  value={config.targetName}
                  onChange={(e) => updateConfig("targetName", e.target.value)}
                  placeholder="Auto from endpoint"
                />
              </div>
              <div className="form-field full">
                <label>API Key</label>
                <input
                  type="password"
                  value={config.apiKey}
                  onChange={(e) => updateConfig("apiKey", e.target.value)}
                  placeholder="sk-... (or use TARGET_API_KEY env var)"
                />
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2>Objective</h2>
            <div className="form-field full">
              <textarea
                value={config.objective}
                onChange={(e) => updateConfig("objective", e.target.value)}
                rows={3}
                placeholder="Describe what the autonomous agent should probe for..."
              />
            </div>
          </section>

          <section className="form-section">
            <h2>Agent Models</h2>
            <div className="form-grid thirds">
              <div className="form-field">
                <label>Commander</label>
                <select
                  value={config.commanderModel}
                  onChange={(e) => updateConfig("commanderModel", e.target.value)}
                >
                  <option value="haiku">Haiku (fast/cheap)</option>
                  <option value="sonnet">Sonnet (balanced)</option>
                  <option value="opus">Opus (best)</option>
                </select>
              </div>
              <div className="form-field">
                <label>Attacker</label>
                <select
                  value={config.attackerModel}
                  onChange={(e) => updateConfig("attackerModel", e.target.value)}
                >
                  <option value="haiku">Haiku (fast/cheap)</option>
                  <option value="sonnet">Sonnet (balanced)</option>
                  <option value="opus">Opus (best)</option>
                </select>
              </div>
              <div className="form-field">
                <label>Recon</label>
                <select
                  value={config.reconModel}
                  onChange={(e) => updateConfig("reconModel", e.target.value)}
                >
                  <option value="haiku">Haiku (fast/cheap)</option>
                  <option value="sonnet">Sonnet (balanced)</option>
                  <option value="opus">Opus (best)</option>
                </select>
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2>Limits</h2>
            <div className="form-grid fourths">
              <div className="form-field">
                <label>Max Attackers</label>
                <input
                  type="number"
                  value={config.maxAttackers}
                  onChange={(e) => updateConfig("maxAttackers", e.target.value)}
                  min="1"
                  max="10"
                />
              </div>
              <div className="form-field">
                <label>Max Turns</label>
                <input
                  type="number"
                  value={config.maxTurns}
                  onChange={(e) => updateConfig("maxTurns", e.target.value)}
                  min="10"
                  max="200"
                />
              </div>
              <div className="form-field">
                <label>Thread Depth</label>
                <input
                  type="number"
                  value={config.maxThreadTurns}
                  onChange={(e) => updateConfig("maxThreadTurns", e.target.value)}
                  min="2"
                  max="20"
                />
              </div>
              <div className="form-field">
                <label>Budget ($)</label>
                <input
                  type="number"
                  value={config.budgetUsd}
                  onChange={(e) => updateConfig("budgetUsd", e.target.value)}
                  min="0.5"
                  max="100"
                  step="0.5"
                />
              </div>
            </div>
          </section>

          {error && (
            <div className="form-error">
              <span>⚠</span> {error}
            </div>
          )}

          <div className="form-actions">
            <button type="button" className="btn-primary" onClick={handleStart} disabled={running}>
              {running ? (
                <>
                  <span className="spinner" /> Starting…
                </>
              ) : (
                "Start Assessment"
              )}
            </button>
            <span className="action-hint">
              Or run <code>opfor-auto auto --ui</code> from CLI
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
