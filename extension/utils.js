export async function sleep(ms) {
  return await new Promise((r) => setTimeout(r, ms));
}

export function formatTranscript(transcript) {
  return transcript
    .map((m) => `${m.role === "user" ? "USER" : "ASSISTANT"}:\n${m.content}`)
    .join("\n\n---\n\n");
}

export function safeJsonParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
