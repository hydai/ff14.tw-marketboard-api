import { Context } from "hono";
import type Database from "better-sqlite3";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  VELOCITY_MIN_SALES_PER_DAY,
} from "../../config/constants.js";
import { getVelocity } from "../../db/queries.js";

type AppEnv = { Variables: { db: Database.Database } };

export function listVelocity(c: Context<AppEnv>) {
  const db = c.get("db");
  const category = c.req.query("category") ? Number(c.req.query("category")) : undefined;
  const minSales = Number(c.req.query("minSales")) || VELOCITY_MIN_SALES_PER_DAY;
  const days = Math.min(30, Math.max(1, Number(c.req.query("days")) || 7));
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query("limit")) || DEFAULT_PAGE_SIZE));

  const data = getVelocity(db, { days, minSales, category, limit });
  return c.json({ data, days });
}
