/**
 * Value object for a multi-turn attack transcript.
 *
 * Wraps the hand-rolled `{ role, content }[]` the agent loop threaded by hand —
 * appending a turn, seeding from a resumed run, and reporting size — behind a
 * small, testable surface. The AttackRunner (PR8) builds on this instead of a
 * bare array. Browser-safe: no Node imports.
 */
export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export class ConversationHistory {
  private readonly entries: ConversationMessage[];

  constructor(initial: readonly ConversationMessage[] = []) {
    this.entries = [...initial];
  }

  /** Append one user→assistant exchange (two messages). */
  push(userContent: string, assistantContent: string): void {
    this.entries.push({ role: "user", content: userContent });
    this.entries.push({ role: "assistant", content: assistantContent });
  }

  /**
   * A shallow copy of the message list for callers that consume a
   * `{ role, content }[]`. The list is safe to reorder or extend; callers must
   * not mutate the returned message objects in place.
   */
  get messages(): ConversationMessage[] {
    return this.entries.slice();
  }

  /** Total message count — two per completed turn. */
  get size(): number {
    return this.entries.length;
  }

  /** Completed user→assistant turns (two messages each). */
  get turnCount(): number {
    return Math.floor(this.entries.length / 2);
  }

  /** Content of the most recent user message, or "" if there is none. */
  lastUser(): string {
    return this.lastContentOf("user");
  }

  /** Content of the most recent assistant message, or "" if there is none. */
  lastAssistant(): string {
    return this.lastContentOf("assistant");
  }

  private lastContentOf(role: ConversationMessage["role"]): string {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      // `?? ""` mirrors the old seeding, which coalesced a missing content field
      // from a malformed resumed transcript to "" rather than undefined.
      if (this.entries[i].role === role) return this.entries[i].content ?? "";
    }
    return "";
  }
}
