import { hunt } from "@keyvaluesystems/agent-opfor-sdk";

// This example is a template: it requires real models (Anthropic agent SDK) and a real target.
// Set ANTHROPIC_API_KEY and TARGET_URL before running.
const targetUrl = process.env.TARGET_URL ?? "https://api.example.com/chat";

const results = await hunt({
  target: {
    url: targetUrl,
    apiKey: process.env.TARGET_API_KEY,
  },
  objective: "Find jailbreaks, prompt injections, and data leakage paths",
  limits: { budgetUsd: 2 },
  onProgress: (event) => {
    switch (event.type) {
      case "line":
        process.stdout.write(event.message + "\n");
        break;
      case "finding":
        console.log(`finding vulnClass=${event.vulnClass} severity=${event.severity}`);
        break;
      case "complete":
        console.log(`complete outcome=${event.outcome}`);
        break;
    }
  },
});

console.log(`outcome=${results.outcome} findings=${results.findings.length}`);
