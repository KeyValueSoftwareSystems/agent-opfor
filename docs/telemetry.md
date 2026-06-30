# Opfor — Trace-aware testing

> Using the SDK? See [SDK telemetry](sdk.md#telemetry).

Plugging in a telemetry provider (Langfuse or Netra) unlocks two capabilities:

- **Grounded attack generation** — opfor fetches real production traces before generating attacks. The attacker LLM sees actual user flows, tool calls, and data the agent handles, making attacks targeted rather than generic.
- **Judge enrichment** — opfor injects a trace ID into each target request, fetches the recorded trace after execution, and passes every tool call, retrieval step, and span to the judge. This catches PII that leaks into a tool call but never reaches the user, and agents that retrieve unauthorized data but render a clean reply.

> **Ingestion delay:** Observability platforms process spans asynchronously. Opfor polls for the trace after all turns complete; some spans may not have arrived yet on multi-turn attacks. Tune `traceFetchInitialDelayMs`, `traceFetchMaxAttempts`, `traceFetchRetryDelayMs` in the telemetry config at the cost of longer scan time. Grounded attack generation reads historic traces and is not affected.

---

## Langfuse

```json
"telemetry": {
  "provider": "langfuse",
  "langfuse": {
    "baseUrl": "https://cloud.langfuse.com",
    "traceSelection": { "lookbackHours": 24 }
  },
  "propagation": { "headers": { "X-Langfuse-Trace-Id": "{{traceId}}" } },
  "enrichJudgeFromTrace": true
}
```

```bash
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_SECRET_KEY=sk-lf-...
```

Use `langfuse.publicKeyEnv` / `langfuse.secretKeyEnv` for custom env var names.

---

## Netra

```json
"telemetry": {
  "provider": "netra",
  "netra": {
    "baseUrl": "http://localhost:3000",
    "traceSelection": { "lookbackHours": 24 }
  },
  "propagation": {
    "traceIdBodyField": "trace_id",
    "traceIdStrategy": "per-attack"
  },
  "enrichJudgeFromTrace": true
}
```

```bash
export NETRA_API_KEY=NE_...
```

Use `netra.apiKeyEnv` for a custom env var name. `propagation.traceIdBodyField` must match a field your agent reads from the request body and forwards to the Netra SDK as the active OTel trace ID — without that wiring, judge enrichment won't correlate.

---

## Config fields reference

### Top-level

| Field                                    | Description                                                             |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `telemetry.provider`                     | `"langfuse"`, `"netra"`, or `"none"` — required                         |
| `telemetry.enrichJudgeFromTrace`         | Fetch the recorded trace after each attack and pass spans to the judge  |
| `telemetry.traceFetchInitialDelayMs`     | Initial delay before first trace fetch (ingestion lag). Default 1000 ms |
| `telemetry.traceFetchMaxAttempts`        | Max polling attempts per trace. Default 8                               |
| `telemetry.traceFetchRetryDelayMs`       | Backoff between polling attempts. Default 1500 ms                       |
| `telemetry.enrichJudgeTraceJsonMaxChars` | Max JSON chars of merged trace passed to the judge. Default 40000       |

### Propagation

| Field                                    | Description                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `telemetry.propagation.headers`          | HTTP headers set on each target request. Values support `{{traceId}}`, `{{runId}}` |
| `telemetry.propagation.traceIdBodyField` | Top-level JSON body field to inject the trace ID into (e.g. `"trace_id"`)          |
| `telemetry.propagation.traceIdStrategy`  | `"per-attack"` (default) or `"per-run"`                                            |
| `telemetry.propagation.traceIdPrefix`    | Prefix for generated trace IDs                                                     |

Header values support `${VAR}` substitution (e.g. `"Authorization": "Bearer ${TARGET_TOKEN}"`).

### Langfuse

| Field                                               | Description                                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `telemetry.langfuse.baseUrl`                        | Langfuse API base URL. Default `https://cloud.langfuse.com`                                     |
| `telemetry.langfuse.baseUrlEnv`                     | Env var name that overrides `baseUrl` at runtime                                                |
| `telemetry.langfuse.publicKeyEnv`                   | Env var holding the public key. Default `LANGFUSE_PUBLIC_KEY`                                   |
| `telemetry.langfuse.secretKeyEnv`                   | Env var holding the secret key. Default `LANGFUSE_SECRET_KEY`                                   |
| `telemetry.langfuse.traceCurationListJsonMaxChars`  | Max chars of list JSON sent to the curator LLM. Default 28000                                   |
| `telemetry.langfuse.traceSummarySourceJsonMaxChars` | Max chars of hydrated JSON sent to the summarizer LLM. Default 100000                           |
| `telemetry.langfuse.traceSummaryForAttackMaxChars`  | Max chars of trace summary passed into attack generation. Default 26000                         |
| `telemetry.langfuse.traceDetailFields`              | `fields` param for `GET /api/public/traces/{id}`. Default `core,io,observations,scores,metrics` |
| `telemetry.langfuse.observationV2Fields`            | `fields` for `/v2/observations` when full observation hydration is needed                       |
| `telemetry.langfuse.observationV2MaxPages`          | Max cursor pages per trace for v2 observations. Default 15                                      |

#### `telemetry.langfuse.traceSelection`

| Field             | Description                                                                           |
| ----------------- | ------------------------------------------------------------------------------------- |
| `lookbackHours`   | Fetch traces from the last N hours (converted to `fromTimestamp` at query time)       |
| `fromTimestamp`   | ISO 8601 lower bound                                                                  |
| `toTimestamp`     | ISO 8601 upper bound                                                                  |
| `setupTraceIds`   | Explicit trace IDs to always include (skips curation, highest precision)              |
| `userId`          | Filter by Langfuse `userId`                                                           |
| `sessionId`       | Filter by Langfuse `sessionId`                                                        |
| `name`            | Filter by trace name (e.g. `"POST /chat"`)                                            |
| `tags`            | Filter to traces that include **all** listed tags                                     |
| `environment`     | Filter by environment string (or array of strings)                                    |
| `version`         | Filter by trace `version`                                                             |
| `release`         | Filter by trace `release`                                                             |
| `orderBy`         | Sort order, e.g. `"timestamp.desc"`                                                   |
| `filter`          | Advanced Langfuse filter conditions (JSON array). Takes precedence over direct params |
| `observationName` | Pre-filter by observation/span name — opfor fetches matching trace IDs first          |
| `observationType` | `"GENERATION"`, `"SPAN"`, or `"EVENT"` — used with `observationName`                  |
| `listLimit`       | Max rows per page for `GET /api/public/traces`. Default 100                           |
| `listMaxPages`    | How many list pages to fetch before curation. Default 1                               |
| `fields`          | Comma-separated field groups in list responses (e.g. `"core,io,scores"`)              |

### Netra

| Field                                            | Description                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------- |
| `telemetry.netra.baseUrl`                        | Netra API base URL (e.g. `http://localhost:3000`)                       |
| `telemetry.netra.baseUrlEnv`                     | Env var name that overrides `baseUrl` at runtime                        |
| `telemetry.netra.apiKeyEnv`                      | Env var holding the API key. Default `NETRA_API_KEY`                    |
| `telemetry.netra.traceCurationListJsonMaxChars`  | Max chars of list JSON sent to the curator LLM. Default 28000           |
| `telemetry.netra.traceSummarySourceJsonMaxChars` | Max chars of hydrated JSON sent to the summarizer LLM. Default 100000   |
| `telemetry.netra.traceSummaryForAttackMaxChars`  | Max chars of trace summary passed into attack generation. Default 26000 |

#### `telemetry.netra.traceSelection`

| Field           | Description                                             |
| --------------- | ------------------------------------------------------- |
| `lookbackHours` | Fetch traces from the last N hours                      |
| `fromTime`      | ISO 8601 lower bound                                    |
| `toTime`        | ISO 8601 upper bound                                    |
| `setupTraceIds` | Explicit trace IDs to always include (skips curation)   |
| `sessionId`     | Filter by session ID                                    |
| `userId`        | Filter by user ID                                       |
| `environment`   | Filter by environment string                            |
| `listLimit`     | Max rows per page (1–100). Default 50                   |
| `listMaxPages`  | How many list pages to fetch before curation. Default 1 |
