/**
 * LLM call retry logic with error classification.
 * Retries on transient errors, fails fast on permanent errors.
 */

import { log } from "./logger.js";

export interface LlmError {
  isRetryable: boolean;
  message: string;
  code: string;
  originalError: unknown;
}

/**
 * Classify an error as retryable or not.
 *
 * Retryable (transient):
 * - Rate limit (429)
 * - Server errors (5xx)
 * - Timeout
 * - Network errors (ECONNREFUSED, ENOTFOUND, etc.)
 *
 * Non-retryable (permanent):
 * - Auth errors (401, 403)
 * - Bad request (400)
 * - Model not found (404)
 * - Invalid API key
 * - Quota exceeded (different from rate limit)
 */
export function classifyError(err: unknown): LlmError {
  const message = err instanceof Error ? err.message : String(err);
  const errorStr = message.toLowerCase();

  // Check for HTTP status codes in error message
  const statusMatch = message.match(/\b(4\d{2}|5\d{2})\b/);
  const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : 0;

  // Rate limit - retryable
  if (
    statusCode === 429 ||
    errorStr.includes("rate limit") ||
    errorStr.includes("too many requests")
  ) {
    return { isRetryable: true, message, code: "RATE_LIMITED", originalError: err };
  }

  // Server errors (5xx) - retryable
  if (statusCode >= 500 && statusCode < 600) {
    return { isRetryable: true, message, code: `HTTP_${statusCode}`, originalError: err };
  }

  // Timeout - retryable
  if (
    errorStr.includes("timeout") ||
    errorStr.includes("timed out") ||
    errorStr.includes("etimedout")
  ) {
    return { isRetryable: true, message, code: "TIMEOUT", originalError: err };
  }

  // Network errors - retryable
  if (
    errorStr.includes("econnrefused") ||
    errorStr.includes("enotfound") ||
    errorStr.includes("econnreset") ||
    errorStr.includes("network") ||
    errorStr.includes("fetch failed")
  ) {
    return { isRetryable: true, message, code: "NETWORK_ERROR", originalError: err };
  }

  // Auth errors - NOT retryable
  if (
    statusCode === 401 ||
    statusCode === 403 ||
    errorStr.includes("unauthorized") ||
    errorStr.includes("forbidden") ||
    errorStr.includes("invalid api key") ||
    errorStr.includes("invalid_api_key") ||
    errorStr.includes("authentication")
  ) {
    return { isRetryable: false, message, code: "AUTH_ERROR", originalError: err };
  }

  // Bad request - NOT retryable
  if (
    statusCode === 400 ||
    errorStr.includes("bad request") ||
    errorStr.includes("invalid request")
  ) {
    return { isRetryable: false, message, code: "BAD_REQUEST", originalError: err };
  }

  // Model not found - NOT retryable
  if (
    statusCode === 404 ||
    errorStr.includes("model not found") ||
    errorStr.includes("does not exist") ||
    errorStr.includes("not found")
  ) {
    return { isRetryable: false, message, code: "MODEL_NOT_FOUND", originalError: err };
  }

  // Quota/billing errors - NOT retryable
  if (
    errorStr.includes("quota") ||
    errorStr.includes("billing") ||
    errorStr.includes("exceeded") ||
    errorStr.includes("insufficient") ||
    errorStr.includes("credits") ||
    errorStr.includes("afford")
  ) {
    return { isRetryable: false, message, code: "QUOTA_EXCEEDED", originalError: err };
  }

  // Default: treat as non-retryable to fail fast on unknown errors
  return { isRetryable: false, message, code: "UNKNOWN_ERROR", originalError: err };
}

export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  context?: string; // e.g., "attacker", "judge" for logging
}

/**
 * Execute an async function with retry logic.
 * Retries on transient errors, throws immediately on permanent errors.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 3, initialDelayMs = 1000, maxDelayMs = 30000, context = "LLM" } = options;

  let lastError: LlmError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = classifyError(err);

      if (!lastError.isRetryable) {
        // Non-retryable error - throw immediately
        log.error(`[${context}] Non-retryable error: ${lastError.code} - ${lastError.message}`);
        throw new NonRetryableError(lastError);
      }

      if (attempt < maxRetries) {
        // Calculate delay with exponential backoff
        const delay = Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
        log.warn(
          `[${context}] Retryable error (attempt ${attempt + 1}/${maxRetries + 1}): ${lastError.code}. Retrying in ${delay}ms...`
        );
        await sleep(delay);
      }
    }
  }

  // All retries exhausted
  log.error(
    `[${context}] All ${maxRetries + 1} attempts failed: ${lastError?.code} - ${lastError?.message}`
  );
  throw new RetryExhaustedError(lastError!);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Error thrown when a non-retryable error is encountered.
 * The run should stop immediately.
 */
export class NonRetryableError extends Error {
  public readonly llmError: LlmError;

  constructor(llmError: LlmError) {
    super(`Non-retryable LLM error: ${llmError.code} - ${llmError.message}`);
    this.name = "NonRetryableError";
    this.llmError = llmError;
  }
}

/**
 * Error thrown when all retry attempts are exhausted.
 * The run should stop and generate partial report.
 */
export class RetryExhaustedError extends Error {
  public readonly llmError: LlmError;

  constructor(llmError: LlmError) {
    super(`LLM retries exhausted: ${llmError.code} - ${llmError.message}`);
    this.name = "RetryExhaustedError";
    this.llmError = llmError;
  }
}

/**
 * Check if an error indicates the run should stop.
 */
export function isStopError(err: unknown): err is NonRetryableError | RetryExhaustedError {
  return err instanceof NonRetryableError || err instanceof RetryExhaustedError;
}

/**
 * Get a user-friendly description of why the run stopped.
 */
export function getStopReason(err: NonRetryableError | RetryExhaustedError): string {
  const { code, message } = err.llmError;

  // Extract the core error message, removing verbose prefixes
  const cleanMessage = message
    .replace(/^.*?:\s*/, "") // Remove "AI_APICallError:" etc.
    .replace(/\. You requested.*$/, "") // Remove token details
    .replace(/\. To increase.*$/, "") // Remove upgrade prompts
    .trim();

  switch (code) {
    case "AUTH_ERROR":
      return `Authentication failed: ${cleanMessage}`;
    case "MODEL_NOT_FOUND":
      return `Model not found: ${cleanMessage}`;
    case "QUOTA_EXCEEDED":
      return `Quota exceeded: ${cleanMessage}`;
    case "BAD_REQUEST":
      return `Invalid request: ${cleanMessage}`;
    case "RATE_LIMITED":
      return `Rate limited (retries exhausted)`;
    case "TIMEOUT":
      return `Request timed out (retries exhausted)`;
    case "NETWORK_ERROR":
      return `Network error: ${cleanMessage}`;
    default:
      return cleanMessage || message;
  }
}
