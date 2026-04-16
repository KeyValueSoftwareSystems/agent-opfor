# Red Team Configurations

Store your red team assessment configurations in this folder.

## Quick Start

1. Copy the template:
   ```bash
   cp ../astra.config.md.example my-target.md
   ```

2. Edit the configuration with your target details

3. Run an assessment:
   ```bash
   npx astra run --config .astra/configs/my-target.md
   ```

## Config File Format

Each config file is a markdown document that describes:

- **Target Information**: Name, type, endpoint, model
- **Application Context**: What it does, who uses it, sensitive data, dangerous actions, forbidden topics
- **System Prompt**: The actual instructions the agent runs under
- **Test Configuration**: Which evaluators/suites to run and depth level
- **Notes**: Additional context for the red team

See [../astra.config.md.example](../astra.config.md.example) for a complete template.

## Examples

### Multiple Configurations

```
.astra/configs/
├── chatbot-prod.md          ← Production support bot
├── chatbot-staging.md       ← Staging environment
├── rag-pipeline.md          ← Retrieval-augmented generation
├── internal-agent.md        ← Internal tool
└── README.md
```

### Running Different Assessments

```bash
# Run full OWASP LLM Top 10 on production
npx astra run --config .astra/configs/chatbot-prod.md

# Run basic checks on staging
npx astra run --config .astra/configs/chatbot-staging.md --suite owasp-llm-top10 --fail-on critical

# Custom evaluators on RAG pipeline
npx astra run --config .astra/configs/rag-pipeline.md --evaluators prompt-injection,sensitive-disclosure
```

## Configuration Naming

Suggested naming convention:
- `[system]-[environment].md` — e.g., `chatbot-prod.md`, `agent-staging.md`
- `[system]-[purpose].md` — e.g., `support-bot-refunds.md`, `rag-research.md`

## Reports

After running an assessment, results are saved to:
- Default: `results/report-[config-name]-[timestamp].md`
- Custom: Use `--output` flag to specify location

```bash
npx astra run --config .astra/configs/chatbot-prod.md --output results/chatbot-prod-2026-04-16.md
```
