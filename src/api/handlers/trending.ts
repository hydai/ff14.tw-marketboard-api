import { Context } from "hono";
import type Database from "better-sqlite3";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants.js";
import { getTrending } from "../../db/queries.js";
import { HTTPError } from "../middleware.js";

type AppEnv = { Variables: { db: Database.Database } };

const VALID_PERIODS = ["1d", "3d", "7d"];

export function listTrending(c: Context<AppEnv>) {
  const db = c.get("db");
  const direction = (c.req.query("direction") ?? "up") as "up" | "down";
  const period = c.req.query("period") ?? "3d";
  const category = c.req.query("category") ? Number(c.req.query("category")) : undefined;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query("limit")) || DEFAULT_PAGE_SIZE));

  if (!["up", "down"].includes(direction)) {
    throw new HTTPError(400, "Invalid direction. Allowed: up, down");
  }
  if (!VALID_PERIODS.includes(period)) {
    throw new HTTPError(400, `Invalid period. Allowed: ${VALID_PERIODS.join(", ")}`);
  }

  const data = getTrending(db, {
    direction,
    period,
    category,
    limit,
  });

  return c.json({ data, direction, period });
}
