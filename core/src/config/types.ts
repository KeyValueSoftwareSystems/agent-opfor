export type ProviderName = "openai" | "anthropic" | "groq" | "google" | "other";

export interface LlmConfig {
  provider: ProviderName;
  model: string;
  apiKey: string;   // stored in prompts file — warn user to gitignore
  baseURL?: string; // only for "other"
}

export interface TargetConfig {
  name: string;
  description: string;
  type: "http-endpoint" | "python-function";
  // http-endpoint fields
  endpoint?: string;
  requestFormat?: "auto" | "openai" | "json";
  targetApiKey?: string;
  targetModel?: string;
  // python-function fields
  functionSignature?: string;
}

export interface AttackEntry {
  evaluatorId: string;
  evaluatorName: string;
  severity: string;
  owasp: string;
  patternName: string;
  prompt: string;
  passCriteria: string;
  failCriteria: string;
}

export interface PromptsFile {
  generatedAt: string;
  llm: LlmConfig;
  target: TargetConfig;
  attacks: AttackEntry[];
}

// Shape of the optional config file passed to `astra setup --config`
export interface SetupConfigFile {
  llm?: {
    provider?: ProviderName;
    model?: string;
    apiKey?: string;
    baseURL?: string;
  };
  target: {
    name: string;
    description: string;
    type: "http-endpoint" | "python-function";
    endpoint?: string;
    requestFormat?: "auto" | "openai" | "json";
    targetApiKey?: string;
    targetModel?: string;
    functionSignature?: string;
  };
  selection:
    | { mode: "suite"; suite: string }
    | { mode: "evaluators"; evaluators: string[] };
}
