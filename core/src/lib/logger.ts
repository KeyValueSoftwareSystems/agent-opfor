const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";

function isColorEnabled(): boolean {
  // Extension/service-worker and other browser bundles have no Node `process`.
  if (typeof process === "undefined") return false;
  return process.stdout?.isTTY !== false && process.env?.NO_COLOR == null;
}

function c(color: string, text: string): string {
  return isColorEnabled() ? `${color}${text}${RESET}` : text;
}

export const log = {
  info(msg: string): void {
    console.log(msg);
  },
  success(msg: string): void {
    console.log(c(GREEN, msg));
  },
  warn(msg: string): void {
    console.warn(c(YELLOW, `Warning: ${msg}`));
  },
  error(msg: string): void {
    console.error(c(RED, `Error: ${msg}`));
  },
  dim(msg: string): void {
    console.log(c(DIM, msg));
  },
};
