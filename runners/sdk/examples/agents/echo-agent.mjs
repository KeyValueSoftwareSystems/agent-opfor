import process from "node:process";

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => {
  raw += c;
});
process.stdin.on("end", () => {
  try {
    const input = JSON.parse(raw);
    const prompt = typeof input?.prompt === "string" ? input.prompt : "";
    const sessionId = typeof input?.sessionId === "string" ? input.sessionId : "";
    const response = sessionId ? `session=${sessionId} prompt=${prompt}` : `prompt=${prompt}`;
    process.stdout.write(JSON.stringify({ response }));
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: String(err?.message ?? err) }));
  }
});
