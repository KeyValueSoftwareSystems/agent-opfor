# @keyvaluesystems/agent-opfor-cli

Opfor CLI — adversarial security testing for AI agents and MCP servers.

## Installation

```bash
npm install -g @keyvaluesystems/agent-opfor-cli
```

## Quick Start

```bash
# Interactive setup wizard — generates a config file
opfor setup

# Run a red-team evaluation against a configured target
opfor run --config .opfor/configs/opfor-config-<id>.json

# Autonomous red-teaming (no config needed)
opfor hunt --endpoint https://api.example.com/chat --objective "Extract system prompt"
```

## Commands

| Command                                          | Description                                                |
| ------------------------------------------------ | ---------------------------------------------------------- |
| `opfor setup`                                    | Interactive wizard — configure target, evaluators, and LLM |
| `opfor run --config <path>`                      | Run a full evaluation from a config file                   |
| `opfor hunt --endpoint <url> --objective <text>` | Autonomous agentic red-team                                |

## Documentation

See [docs.agentopfor.ai/cli](https://docs.agentopfor.ai/cli) for full CLI reference and [docs.agentopfor.ai/hunt](https://docs.agentopfor.ai/hunt) for autonomous mode.

## License

Apache-2.0
