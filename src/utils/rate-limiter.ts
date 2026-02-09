import { createLogger } from "./logger.js";

const log = createLogger("rate-limiter");

export class RateLimiter {
  private active = 0;
  private queue: (() => void)[] = [];

  constructor(
    private maxConcurrent: number,
    private delayMs: number = 200,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  async runAll<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
    return Promise.all(tasks.map((task) => this.run(task)));
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      // Small delay between tasks to avoid bursts
      setTimeout(next, this.delayMs);
    } else {
      this.active--;
    }
  }
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxRetries?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelay = opts.baseDelayMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxRetries) throw err;

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * baseDelay * 0.5;
      log.warn("Retrying after error", {
        attempt: attempt + 1,
        maxRetries,
        delayMs: Math.round(delay),
        error: String(err),
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error("Unreachable");
}
