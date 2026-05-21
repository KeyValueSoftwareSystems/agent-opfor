import { config as dotenvConfig } from "dotenv";
import path from "node:path";

export function loadEnvFromFlag(envPath: string): void {
  const p = path.resolve(envPath);
  dotenvConfig({ path: p });
}
