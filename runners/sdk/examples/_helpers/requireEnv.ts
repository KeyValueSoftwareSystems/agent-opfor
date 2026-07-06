export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}
