/**
 * Unit tests for the deterministic agent-power profile deriver.
 *
 * Run with: npm test --workspace=core
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAgentProfile } from "../src/execute/agentProfile.js";
import type { AgentTargetConfig } from "../src/execute/types.js";

const agentTarget = (extra: Partial<AgentTargetConfig> = {}): AgentTargetConfig => ({
  kind: "agent",
  name: "t",
  description: "d",
  type: "http-endpoint",
  ...extra,
});

test("a tool-calling, multi-tenant, money-moving agent scores high power", () => {
  const profile = deriveAgentProfile({
    businessUseCase:
      "Internal customer support bot for an e-commerce platform. Handles order lookups, refunds, " +
      "and ticket creation. Has access to PostgreSQL with multi-tenant user data across " +
      "free/premium/admin tiers. Uses persistent memory to track prior conversations.",
  });

  // autonomy 1.0 (refunds) + tools 1.0 (postgres/user data) + identity 1.0 (multi-tenant/tiers/admin)
  // + persistence 0.5 (persistent memory) = 3.5 / 4 = 0.875
  assert.equal(profile.factors.autonomy, 1.0);
  assert.equal(profile.factors.tools, 1.0);
  assert.equal(profile.factors.identity, 1.0);
  assert.equal(profile.factors.persistence, 0.5);
  assert.equal(profile.power, 0.875);
  assert.match(profile.rationale, /tenant|role/);
});

test("a read-only bot scores low, baseline power", () => {
  const profile = deriveAgentProfile({
    businessUseCase: "A read-only FAQ chatbot that answers product questions.",
    target: agentTarget(),
  });

  assert.equal(profile.factors.autonomy, 0.5);
  assert.equal(profile.factors.tools, 0.5);
  assert.equal(profile.factors.identity, 0);
  assert.equal(profile.factors.persistence, 0);
  assert.equal(profile.power, 0.25);
  assert.match(profile.rationale, /No strong agentic amplifiers/);
});

test("empty input still returns a valid baseline profile", () => {
  const profile = deriveAgentProfile({});
  assert.equal(profile.power, 0.25);
  assert.ok(profile.power >= 0 && profile.power <= 1);
  assert.equal(typeof profile.rationale, "string");
});

test("target.description alone can fire keyword signals (no businessUseCase)", () => {
  const profile = deriveAgentProfile({
    target: agentTarget({
      description: "Agent that processes refunds and accesses PostgreSQL user records.",
    }),
  });
  assert.equal(profile.factors.autonomy, 1.0);
  assert.equal(profile.factors.tools, 1.0);
});

test("target.description and businessUseCase are combined for signal detection", () => {
  const profile = deriveAgentProfile({
    businessUseCase: "Handles refunds.",
    target: agentTarget({
      description: "Multi-tenant customer support agent with persistent memory.",
    }),
  });
  assert.equal(profile.factors.autonomy, 1.0);
  assert.equal(profile.factors.identity, 1.0);
  assert.equal(profile.factors.persistence, 0.5);
});

test("stateful flag on target does NOT affect persistence — only text signals do", () => {
  const profile = deriveAgentProfile({
    businessUseCase: "Bot that answers questions.",
    target: agentTarget({ stateful: true }),
  });
  assert.equal(profile.factors.persistence, 0);
});

test("memory keywords in the use case lift persistence with no target metadata", () => {
  const profile = deriveAgentProfile({
    businessUseCase: "Assistant with long-term memory of prior conversations.",
  });
  assert.equal(profile.factors.persistence, 0.5);
});

test("knowledge base / RAG / vector store signals lift persistence", () => {
  const profile = deriveAgentProfile({
    target: agentTarget({
      description: "Agent backed by a vector store for document retrieval.",
    }),
  });
  assert.equal(profile.factors.persistence, 0.5);
});

test("power stays within [0,1] across factor combinations", () => {
  const profile = deriveAgentProfile({
    businessUseCase: "Deletes records, transfers funds, admin across tenants, persistent memory.",
  });
  assert.ok(profile.power >= 0 && profile.power <= 1);
});
