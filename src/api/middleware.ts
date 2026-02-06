import { Context, Next } from "hono";
import { cors } from "hono/cors";
import { createLogger } from "../utils/logger";
import type { Env } from "../env";

const log = createLogger("api");

export function corsMiddleware() {
  return cors({ origin: "*" });
}

export async function errorHandler(c: Context<{ Bindings: Env }>, next: Next) {
  try {
    await next();
  } catch (err) {
    const status = err instanceof HTTPError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Internal server error";

    log.error("Unhandled error", {
      path: c.req.path,
      method: c.req.method,
      status,
      error: message,
    });

    return c.json({ error: message }, status as 400);
  }
}

export async function requestLogger(c: Context<{ Bindings: Env }>, next: Next) {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  log.info("Request", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  });
}

export class HTTPError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
