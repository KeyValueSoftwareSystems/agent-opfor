import { useState, useEffect, useRef } from "react";
import wordmark from "../assets/opfor-wordmark.svg";

interface Props {
  onStart: () => void;
}

interface Config {
  endpoint: string;
  model: string;
  targetName: string;
  objective: string;
  // The TARGET's bearer token, read from this env var. Opfor's own commander/operator
  // models authenticate separately via ANTHROPIC_API_KEY et al.
  apiKeyEnv: string;
  promptPath: string;
  responsePath: string;
  // Session handling: "stateless" (replay history), "client" (we send the id),
  // "server" (target returns its own id). send/receive location is body|header.
  sessionMode: string;
  sessionSendIn: string;
  sessionSendName: string;
  sessionReceiveIn: string;
  sessionReceiveName: string;
  commanderModel: string;
  operatorModel: string;
  scoutModel: string;
  maxOperators: string;
  maxTurns: string;
  maxThreadTurns: string;
  budgetUsd: string;
  maxTotalThreads: string;
  maxForksPerThread: string;
  maxDepth: string;
  maxLeadsPerWave: string;
  maxReconProbes: string;
  maxTotalSends: string;
  verifierModel: string;
  sequential: boolean;
  verify: boolean;
}

interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

const defaultConfig: Config = {
  endpoint: "",
  model: "",
  targetName: "",
  objective: "Probe for jailbreaks, system-prompt leakage, and safety bypasses.",
  apiKeyEnv: "",
  promptPath: "",
  responsePath: "",
  sessionMode: "stateless",
  sessionSendIn: "body",
  sessionSendName: "session_id",
  sessionReceiveIn: "body",
  sessionReceiveName: "session_id",
  commanderModel: "haiku",
  operatorModel: "haiku",
  scoutModel: "haiku",
  maxOperators: "3",
  maxTurns: "50",
  maxThreadTurns: "8",
  budgetUsd: "2",
  maxTotalThreads: "40",
  maxForksPerThread: "4",
  maxDepth: "3",
  maxLeadsPerWave: "4",
  maxReconProbes: "8",
  maxTotalSends: "",
  verifierModel: "",
  sequential: false,
  verify: false,
};

type EnvStatus = "idle" | "checking" | "set" | "missing";

/** Which credential the commander/operator/scout agents run on. Never a secret value. */
interface BrainAuth {
  method?: string;
  warning?: string;
}

/**
 * "detected" runs on whatever resolveBrainAuth() found in the environment (or blocks
 * start if that's nothing). The other two are a one-run override, applied to
 * process.env server-side and never written to disk — for someone who launched
 * --ui specifically to avoid touching a terminal or .env file at all.
 */
type BrainAuthMode = "detected" | "apiKey" | "gateway";

export function SetupPage({ onStart }: Props) {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [headers, setHeaders] = useState<HeaderRow[]>([]);
  // A ref, not state: row ids only need to be unique React keys, and reading a
  // counter out of state here would hand every add in the same tick the same id.
  const headerIdRef = useRef(1);
  // Only the auto-detect effect below should flip `verify` on for the user; once they've
  // touched the checkbox themselves, their choice wins even if the effect fires again.
  const verifyTouchedRef = useRef(false);
  const [envStatus, setEnvStatus] = useState<EnvStatus>("idle");
  const [brainAuth, setBrainAuth] = useState<BrainAuth>({});
  const [brainAuthMode, setBrainAuthMode] = useState<BrainAuthMode>("detected");
  const [brainAuthApiKey, setBrainAuthApiKey] = useState("");
  const [brainAuthBaseUrl, setBrainAuthBaseUrl] = useState("");
  const [brainAuthAuthToken, setBrainAuthAuthToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch initial config from CLI flags
  useEffect(() => {
    fetch("/api/initial-config")
      .then((res) => res.json())
      .then((initial: Partial<Config>) => {
        setConfig((prev) => ({
          ...prev,
          ...Object.fromEntries(
            Object.entries(initial).filter(([, v]) => v !== undefined && v !== "")
          ),
        }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Resolved by the CLI before this page was served. Defaults to "detected" only
  // when something was actually found — otherwise the override fields are already
  // open, since --ui exists so this doesn't need a terminal or .env edit at all.
  useEffect(() => {
    fetch("/api/brain-auth")
      .then((res) => res.json())
      .then((data: BrainAuth) => {
        setBrainAuth(data ?? {});
        setBrainAuthMode(data?.method ? "detected" : "apiKey");
      })
      .catch(() => setBrainAuthMode("apiKey"));
  }, []);

  // Mirrors the CLI's --verify default (on when a credential is available). Reuses the
  // brainAuth fetch above instead of a second, narrower check; never overrides a manual choice.
  useEffect(() => {
    if (brainAuth.method && !verifyTouchedRef.current) {
      setConfig((prev) => (verifyTouchedRef.current ? prev : { ...prev, verify: true }));
    }
  }, [brainAuth.method]);

  // Tell the user whether the named env var actually resolves, rather than letting
  // them discover a typo as a 401 twenty seconds into a run.
  useEffect(() => {
    const name = config.apiKeyEnv.trim();
    if (!name) {
      setEnvStatus("idle");
      return;
    }
    setEnvStatus("checking");
    // The debounce alone can't stop a request already in flight from resolving
    // after a newer one and overwriting the badge with a stale result.
    let stale = false;
    const timer = setTimeout(() => {
      fetch(`/api/env-check?name=${encodeURIComponent(name)}`)
        .then((res) => res.json())
        .then((data: { set?: boolean }) => {
          if (!stale) setEnvStatus(data.set ? "set" : "missing");
        })
        .catch(() => {
          if (!stale) setEnvStatus("idle");
        });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [config.apiKeyEnv]);

  const updateConfig = <K extends keyof Config>(key: K, value: Config[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const addHeader = () => {
    const id = headerIdRef.current++;
    setHeaders((prev) => [...prev, { id, name: "", value: "" }]);
  };

  const updateHeader = (id: number, field: "name" | "value", value: string) => {
    setHeaders((prev) => prev.map((h) => (h.id === id ? { ...h, [field]: value } : h)));
  };

  const removeHeader = (id: number) => {
    setHeaders((prev) => prev.filter((h) => h.id !== id));
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

    let brainAuthOverride: Record<string, string> | undefined;
    if (brainAuthMode === "apiKey") {
      if (!brainAuthApiKey.trim()) {
        setError("Provide an API key, or switch to Detected/Gateway");
        return;
      }
      brainAuthOverride = { mode: "apiKey", apiKey: brainAuthApiKey.trim() };
    } else if (brainAuthMode === "gateway") {
      if (!brainAuthBaseUrl.trim() || !brainAuthAuthToken.trim()) {
        setError("Gateway needs both a base URL and an auth token");
        return;
      }
      brainAuthOverride = {
        mode: "gateway",
        baseUrl: brainAuthBaseUrl.trim(),
        authToken: brainAuthAuthToken.trim(),
      };
    }

    const headerMap: Record<string, string> = {};
    for (const h of headers) {
      const name = h.name.trim();
      if (name) headerMap[name] = h.value;
    }

    setRunning(true);

    try {
      const res = await fetch("/api/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...config, headers: headerMap, brainAuthOverride }),
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

  if (loading) {
    return (
      <div className="setup-page">
        <div className="rain" aria-hidden="true" />
        <div className="setup-container">
          <div className="loading">Loading configuration…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="setup-page">
      <div className="rain" aria-hidden="true" />
      <div className="setup-container">
        <header className="setup-header">
          <img className="setup-logo" src={wordmark} alt="Agent OPFOR" />
          <h1>Autonomous Assessment</h1>
          <p>Configure and launch an autonomous red-team assessment</p>
        </header>

        <div className="setup-form">
          <div className="brackets" aria-hidden="true" />

          <div className="brain-auth-section">
            <div className="brain-auth-header">
              <span className="brain-auth-label">Attacker agents</span>
              {brainAuthMode === "detected" && brainAuth.method && (
                <span className="brain-auth-value">{brainAuth.method}</span>
              )}
            </div>

            {brainAuthMode === "detected" && brainAuth.method && (
              <p className="brain-auth-note">Read from your environment when this page loaded</p>
            )}

            {brainAuth.warning && brainAuthMode === "detected" && (
              <div className="brain-auth-warning">
                <span className="form-error-icon">!</span> {brainAuth.warning}
              </div>
            )}

            {!brainAuth.method && brainAuthMode === "apiKey" && (
              <p className="brain-auth-note">
                No credential detected in the environment — provide one below for this run.
              </p>
            )}

            <div className="mode-row" role="radiogroup" aria-label="Attacker agent credential">
              {brainAuth.method && (
                <label className="mode-pill">
                  <input
                    type="radio"
                    name="brainAuthMode"
                    checked={brainAuthMode === "detected"}
                    onChange={() => setBrainAuthMode("detected")}
                  />
                  Detected
                </label>
              )}
              <label className="mode-pill">
                <input
                  type="radio"
                  name="brainAuthMode"
                  checked={brainAuthMode === "apiKey"}
                  onChange={() => setBrainAuthMode("apiKey")}
                />
                API key
              </label>
              <label className="mode-pill">
                <input
                  type="radio"
                  name="brainAuthMode"
                  checked={brainAuthMode === "gateway"}
                  onChange={() => setBrainAuthMode("gateway")}
                />
                Gateway
              </label>
            </div>

            {brainAuthMode === "apiKey" && (
              <div className="form-field full">
                <input
                  type="password"
                  autoComplete="off"
                  value={brainAuthApiKey}
                  onChange={(e) => setBrainAuthApiKey(e.target.value)}
                  placeholder="sk-ant-…"
                />
                <span className="field-hint">This run only — never written to disk</span>
              </div>
            )}

            {brainAuthMode === "gateway" && (
              <div className="form-grid">
                <div className="form-field full">
                  <input
                    type="text"
                    value={brainAuthBaseUrl}
                    onChange={(e) => setBrainAuthBaseUrl(e.target.value)}
                    placeholder="https://your-gateway.example.com"
                  />
                </div>
                <div className="form-field full">
                  <input
                    type="password"
                    autoComplete="off"
                    value={brainAuthAuthToken}
                    onChange={(e) => setBrainAuthAuthToken(e.target.value)}
                    placeholder="gateway auth token"
                  />
                  <span className="field-hint">This run only — never written to disk</span>
                </div>
              </div>
            )}
          </div>

          <section className="form-section">
            <h2>Target</h2>
            <div className="form-grid">
              <div className="form-field full">
                <label>
                  <span>
                    Endpoint URL <span className="req">*</span>
                  </span>
                </label>
                <input
                  type="url"
                  value={config.endpoint}
                  onChange={(e) => updateConfig("endpoint", e.target.value)}
                  placeholder="https://your-agent.example.com/chat"
                />
              </div>
              <div className="form-field optional">
                <label>
                  <span>Target Model</span>
                  <span className="label-tag">(optional)</span>
                </label>
                <input
                  type="text"
                  value={config.model}
                  onChange={(e) => updateConfig("model", e.target.value)}
                  placeholder="gpt-4o-mini"
                />
                <span className="field-hint">Only for raw LLM APIs</span>
              </div>
              <div className="form-field optional">
                <label>
                  <span>Display Name</span>
                  <span className="label-tag">(optional)</span>
                </label>
                <input
                  type="text"
                  value={config.targetName}
                  onChange={(e) => updateConfig("targetName", e.target.value)}
                  placeholder="Auto from endpoint"
                />
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2>Request</h2>
            <div className="form-grid">
              <div className="form-field optional full">
                <label>
                  <span>Bearer Token Env Var</span>
                  <span className="label-tag">(optional)</span>
                  {envStatus === "set" && <span className="env-badge ok">detected</span>}
                  {envStatus === "missing" && <span className="env-badge missing">not set</span>}
                </label>
                <input
                  type="text"
                  value={config.apiKeyEnv}
                  onChange={(e) => updateConfig("apiKeyEnv", e.target.value)}
                  placeholder="TARGET_API_KEY"
                />
                <span className="field-hint">The target&apos;s credential, not Opfor&apos;s</span>
              </div>

              <div className="form-field full">
                <label>
                  <span>Custom Headers</span>
                  <span className="label-tag">(optional)</span>
                </label>
                {headers.length > 0 && (
                  <div className="header-rows">
                    {headers.map((h) => (
                      <div className="header-row" key={h.id}>
                        <input
                          type="text"
                          value={h.name}
                          onChange={(e) => updateHeader(h.id, "name", e.target.value)}
                          placeholder="x-api-key"
                          aria-label="Header name"
                        />
                        <input
                          type="text"
                          value={h.value}
                          onChange={(e) => updateHeader(h.id, "value", e.target.value)}
                          placeholder="value"
                          aria-label="Header value"
                        />
                        <button
                          type="button"
                          className="row-remove"
                          onClick={() => removeHeader(h.id)}
                          aria-label="Remove header"
                          title="Remove header"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button" className="btn-ghost" onClick={addHeader}>
                  + Add header
                </button>
              </div>

              <div className="form-field optional">
                <label>
                  <span>Prompt Path</span>
                  <span className="label-tag">(optional)</span>
                </label>
                <input
                  type="text"
                  value={config.promptPath}
                  onChange={(e) => updateConfig("promptPath", e.target.value)}
                  placeholder="messages"
                />
              </div>
              <div className="form-field optional">
                <label>
                  <span>Response Path</span>
                  <span className="label-tag">(optional)</span>
                </label>
                <input
                  type="text"
                  value={config.responsePath}
                  onChange={(e) => updateConfig("responsePath", e.target.value)}
                  placeholder="data.reply"
                />
                <span className="field-hint">Both blank for OpenAI-shape endpoints</span>
              </div>
            </div>
          </section>

          <section className="form-section">
            <h2>
              <span>
                Objective <span className="req">*</span>
              </span>
            </h2>
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
            <h2>Session</h2>
            <div className="form-grid">
              <div className="form-field full">
                <label>
                  <span>Session handling</span>
                </label>
                <select
                  value={config.sessionMode}
                  onChange={(e) => updateConfig("sessionMode", e.target.value)}
                >
                  <option value="stateless">Stateless — replay full history each turn</option>
                  <option value="client">Client-owned — we send the session id</option>
                  <option value="server">Server-owned — target returns its own id</option>
                </select>
              </div>
              {config.sessionMode !== "stateless" &&
                (config.sessionMode === "server" && config.sessionReceiveIn === "set-cookie" ? (
                  <div className="form-field full">
                    <label>
                      <span>Send location</span>
                    </label>
                    <span className="field-hint">
                      Echoed back via the <code>Cookie</code> header
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="form-field">
                      <label>
                        <span>Send location</span>
                      </label>
                      <select
                        value={config.sessionSendIn}
                        onChange={(e) => updateConfig("sessionSendIn", e.target.value)}
                      >
                        <option value="body">Request body field</option>
                        <option value="header">Request header</option>
                      </select>
                    </div>
                    <div className="form-field">
                      <label>
                        <span>Send name</span>
                      </label>
                      <input
                        type="text"
                        value={config.sessionSendName}
                        onChange={(e) => updateConfig("sessionSendName", e.target.value)}
                        placeholder={
                          config.sessionSendIn === "header" ? "X-Session-Id" : "session_id"
                        }
                      />
                    </div>
                  </>
                ))}
              {config.sessionMode === "server" && (
                <>
                  <div className="form-field">
                    <label>
                      <span>Return location</span>
                    </label>
                    <select
                      value={config.sessionReceiveIn}
                      onChange={(e) => updateConfig("sessionReceiveIn", e.target.value)}
                    >
                      <option value="body">Response body dot-path</option>
                      <option value="header">Response header</option>
                      <option value="set-cookie">Set-Cookie</option>
                    </select>
                  </div>
                  <div className="form-field">
                    <label>
                      <span>Return name</span>
                    </label>
                    <input
                      type="text"
                      value={config.sessionReceiveName}
                      onChange={(e) => updateConfig("sessionReceiveName", e.target.value)}
                      placeholder={
                        config.sessionReceiveIn === "header" ? "Mcp-Session-Id" : "session_id"
                      }
                    />
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="form-section">
            <h2>Agent Models</h2>
            <div className="form-grid thirds">
              <div className="form-field">
                <label>
                  <span>Commander</span>
                </label>
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
                <label>
                  <span>Operator</span>
                </label>
                <select
                  value={config.operatorModel}
                  onChange={(e) => updateConfig("operatorModel", e.target.value)}
                >
                  <option value="haiku">Haiku (fast/cheap)</option>
                  <option value="sonnet">Sonnet (balanced)</option>
                  <option value="opus">Opus (best)</option>
                </select>
              </div>
              <div className="form-field">
                <label>
                  <span>Scout</span>
                </label>
                <select
                  value={config.scoutModel}
                  onChange={(e) => updateConfig("scoutModel", e.target.value)}
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
                <label>
                  <span>Max Operators</span>
                </label>
                <input
                  type="number"
                  value={config.maxOperators}
                  onChange={(e) => updateConfig("maxOperators", e.target.value)}
                  min="1"
                  max="10"
                />
              </div>
              <div className="form-field">
                <label>
                  <span>Max Turns</span>
                </label>
                <input
                  type="number"
                  value={config.maxTurns}
                  onChange={(e) => updateConfig("maxTurns", e.target.value)}
                  min="10"
                  max="200"
                />
              </div>
              <div className="form-field">
                <label>
                  <span>Thread Depth</span>
                </label>
                <input
                  type="number"
                  value={config.maxThreadTurns}
                  onChange={(e) => updateConfig("maxThreadTurns", e.target.value)}
                  min="2"
                  max="20"
                />
              </div>
              <div className="form-field">
                <label>
                  <span>Budget ($)</span>
                </label>
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

          <details className="form-advanced">
            <summary>
              <span>Advanced</span>
              <span className="advanced-hint">limits · rate limiting · verification</span>
            </summary>

            <div className="form-grid fourths advanced-grid">
              <div className="form-field">
                <label>
                  <span>Total Threads</span>
                </label>
                <input
                  type="number"
                  value={config.maxTotalThreads}
                  onChange={(e) => updateConfig("maxTotalThreads", e.target.value)}
                  min="1"
                  max="200"
                />
              </div>
              <div className="form-field">
                <label>
                  <span>Forks / Thread</span>
                </label>
                <input
                  type="number"
                  value={config.maxForksPerThread}
                  onChange={(e) => updateConfig("maxForksPerThread", e.target.value)}
                  min="1"
                  max="20"
                />
              </div>
              <div className="form-field">
                <label>
                  <span>Max Depth</span>
                </label>
                <input
                  type="number"
                  value={config.maxDepth}
                  onChange={(e) => updateConfig("maxDepth", e.target.value)}
                  min="1"
                  max="10"
                />
              </div>
              <div className="form-field">
                <label>
                  <span>Leads / Wave</span>
                </label>
                <input
                  type="number"
                  value={config.maxLeadsPerWave}
                  onChange={(e) => updateConfig("maxLeadsPerWave", e.target.value)}
                  min="1"
                  max="20"
                />
              </div>
              <div className="form-field">
                <label>
                  <span>Recon Probes</span>
                </label>
                <input
                  type="number"
                  value={config.maxReconProbes}
                  onChange={(e) => updateConfig("maxReconProbes", e.target.value)}
                  min="1"
                  max="50"
                />
              </div>
              <div className="form-field optional">
                <label>
                  <span>Max Sends</span>
                  <span className="label-tag">(optional)</span>
                </label>
                <input
                  type="number"
                  value={config.maxTotalSends}
                  onChange={(e) => updateConfig("maxTotalSends", e.target.value)}
                  min="1"
                  placeholder="from budget"
                />
              </div>
              <div className="form-field optional">
                <label>
                  <span>Verifier Model</span>
                  <span className="label-tag">(optional)</span>
                </label>
                <input
                  type="text"
                  value={config.verifierModel}
                  onChange={(e) => updateConfig("verifierModel", e.target.value)}
                  placeholder="commander model"
                />
              </div>
            </div>

            <div className="toggle-list">
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.sequential}
                  onChange={(e) => updateConfig("sequential", e.target.checked)}
                />
                <span className="toggle-body">
                  <span className="toggle-title">Sequential operators</span>
                  <span className="toggle-hint">For rate-limited targets</span>
                </span>
              </label>
              <label className="toggle">
                <input
                  type="checkbox"
                  checked={config.verify}
                  onChange={(e) => {
                    verifyTouchedRef.current = true;
                    updateConfig("verify", e.target.checked);
                  }}
                />
                <span className="toggle-body">
                  <span className="toggle-title">Second-model verification</span>
                  <span className="toggle-hint">
                    Independent model re-checks findings — on by default when a Claude credential is
                    available
                  </span>
                </span>
              </label>
            </div>
          </details>

          {error && (
            <div className="form-error">
              <span className="form-error-icon">!</span> {error}
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
          </div>
        </div>
      </div>
    </div>
  );
}
