# @opfor/sdk

Opfor SDK — programmatic adversarial testing for AI systems.

## Installation

```bash
npm install @opfor/sdk
```

## Quick Start

### Functional API

```typescript
import { execute, report } from "@opfor/sdk";

const results = await execute({
  target: {
    url: "https://api.example.com/chat",
    apiKey: process.env.TARGET_API_KEY,
  },
  suite: "owasp-llm-top10",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

console.log(results.score);
await report(results).html("./report.html");
```

### Class-based API

```typescript
import { Opfor } from "@opfor/sdk";

const opfor = new Opfor({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const results = await opfor.execute({
  target: { url: "https://api.example.com/chat" },
  suite: "owasp-llm-top10",
});

await opfor.report(results).json("./report.json");
```

## Documentation

See [docs/sdk.md](../../docs/sdk.md) for full documentation.

## License

Apache-2.0
