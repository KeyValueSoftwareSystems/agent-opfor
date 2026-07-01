/**
 * PR7 — ConversationHistory value object.
 *
 * Pins the transcript behavior the agent loop relied on: seeding from a resumed
 * run, appending turns, size, and last-message lookups.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConversationHistory } from "../src/execute/conversationHistory.js";

test("starts empty", () => {
  const h = new ConversationHistory();
  assert.strictEqual(h.size, 0);
  assert.deepStrictEqual(h.messages, []);
  assert.strictEqual(h.lastUser(), "");
  assert.strictEqual(h.lastAssistant(), "");
});

test("push appends a user→assistant exchange in order", () => {
  const h = new ConversationHistory();
  h.push("u1", "a1");
  h.push("u2", "a2");
  assert.strictEqual(h.size, 4);
  assert.deepStrictEqual(h.messages, [
    { role: "user", content: "u1" },
    { role: "assistant", content: "a1" },
    { role: "user", content: "u2" },
    { role: "assistant", content: "a2" },
  ]);
});

test("seeds from an initial (resumed) transcript without aliasing it", () => {
  const initial = [
    { role: "user" as const, content: "u1" },
    { role: "assistant" as const, content: "a1" },
  ];
  const h = new ConversationHistory(initial);
  assert.strictEqual(h.size, 2);
  h.push("u2", "a2");
  // Mutating the history must not mutate the caller's array.
  assert.strictEqual(initial.length, 2);
});

test("messages returns a snapshot copy, not the internal array", () => {
  const h = new ConversationHistory();
  h.push("u1", "a1");
  const snapshot = h.messages;
  snapshot.push({ role: "user", content: "injected" });
  assert.strictEqual(h.size, 2); // external mutation of the snapshot leaves state intact
});

test("turnCount reports completed user→assistant turns", () => {
  const h = new ConversationHistory();
  assert.strictEqual(h.turnCount, 0);
  h.push("u1", "a1");
  assert.strictEqual(h.turnCount, 1);
  h.push("u2", "a2");
  assert.strictEqual(h.turnCount, 2);
});

test("last lookups coalesce a missing content field to '' (malformed resumed transcript)", () => {
  // A malformed resumed transcript could carry an undefined content; the old
  // seeding coalesced it to "" and the value object must preserve that.
  const h = new ConversationHistory([
    { role: "user", content: undefined as unknown as string },
    { role: "assistant", content: undefined as unknown as string },
  ]);
  assert.strictEqual(h.lastUser(), "");
  assert.strictEqual(h.lastAssistant(), "");
});

test("lastUser / lastAssistant return the most recent of each role", () => {
  const h = new ConversationHistory();
  h.push("u1", "a1");
  h.push("u2", "a2");
  assert.strictEqual(h.lastUser(), "u2");
  assert.strictEqual(h.lastAssistant(), "a2");
});

test("last lookups return '' when the role is absent", () => {
  const h = new ConversationHistory([{ role: "user", content: "only-user" }]);
  assert.strictEqual(h.lastUser(), "only-user");
  assert.strictEqual(h.lastAssistant(), "");
});
