import { createLogger } from "./logger";

const log = createLogger("d1-retry");

const TRANSIENT_PATTERNS = [
  "Network connection lost",
  "internal error",
  "connection reset",
];

export function isTransientD1Error(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((pattern) =>
    message.toLowerCase().includes(pattern.toLowerCase())
  );
}

interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

export async function withD1Retry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelay = options?.baseDelayMs ?? 100;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isTransientD1Error(err) || attempt === maxAttempts) {
        throw err;
      }

      const jitter = Math.random() * baseDelay * 0.5;
      const delay = baseDelay * Math.pow(2, attempt - 1) + jitter;

      log.warn("Transient D1 error, retrying", {
        attempt,
        maxAttempts,
        delayMs: Math.round(delay),
        error: String(err),
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
