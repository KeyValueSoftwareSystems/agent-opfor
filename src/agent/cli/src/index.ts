// Load `.env` from cwd (and defaults per dotenv) so GROQ_API_KEY, LANGFUSE_*, etc.
// work without exporting in the shell. Matches unified `astra` CLI behaviour.
import { config as loadDotenv } from "dotenv";
loadDotenv();

import { buildEmptyAgentSetupConfig, collectAgentSetupConfigInteractive } from "./wizard/unifiedSetupWizard.js";
import { generateAgentAttacksFromConfig } from "./commands/setup.js";
import { runAgentAttacksFromFile } from "./commands/run.js";

export { buildEmptyAgentSetupConfig, collectAgentSetupConfigInteractive };
export { generateAgentAttacksFromConfig, runAgentAttacksFromFile };
