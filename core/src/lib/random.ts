// Browser-safe random utilities. Uses globalThis.crypto, which is available
// in Node 18+ and every modern browser, so the same module compiles for both
// the @opfor/core (Node) and @opfor/core/browser entries.

export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

export function randomTraceHex(byteLen = 16): string {
  const bytes = new Uint8Array(byteLen);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
