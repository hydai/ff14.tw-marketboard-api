import { Context } from "hono";
import type Database from "better-sqlite3";
import {
  DEALS_MAX_PERCENTILE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../../config/constants.js";
import { getDeals } from "../../db/queries.js";
import { resolveWorld } from "../../config/datacenters.js";
import { HTTPError } from "../middleware.js";

type AppEnv = { Variables: { db: Database.Database } };

export function listDeals(c: Context<AppEnv>) {
  const db = c.get("db");
  const maxPercentile = Number(c.req.query("maxPercentile")) || DEALS_MAX_PERCENTILE;
  const category = c.req.query("category") ? Number(c.req.query("category")) : undefined;
  const worldParam = c.req.query("world");
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query("limit")) || DEFAULT_PAGE_SIZE));

  let worldId: number | undefined;
  if (worldParam) {
    const world = resolveWorld(worldParam);
    if (!world) throw new HTTPError(404, "World not found");
    worldId = world.id;
  }

  const data = getDeals(db, {
    maxPercentile,
    category,
    worldId,
    limit,
  });

  return c.json({ data });
}
