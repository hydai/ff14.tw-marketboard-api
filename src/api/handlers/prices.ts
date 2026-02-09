import { Context } from "hono";
import type Database from "better-sqlite3";
import {
  getListingsByItem,
  getListingsByItemAndWorld,
  getPriceHistory,
  getRecentSales,
} from "../../db/queries.js";
import { resolveWorld } from "../../config/datacenters.js";
import { HTTPError } from "../middleware.js";

type AppEnv = { Variables: { db: Database.Database } };

const PERIOD_HOURS: Record<string, number> = {
  "1d": 24,
  "3d": 72,
  "7d": 168,
  "14d": 336,
  "30d": 720,
  "90d": 2160,
};

export function getListings(c: Context<AppEnv>) {
  const db = c.get("db");
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) throw new HTTPError(400, "Invalid item ID");

  const hqParam = c.req.query("hq");
  const hq = hqParam === "true" ? true : hqParam === "false" ? false : undefined;

  const data = getListingsByItem(db, itemId, hq);
  return c.json({ data });
}

export function getWorldListings(c: Context<AppEnv>) {
  const db = c.get("db");
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) throw new HTTPError(400, "Invalid item ID");

  const worldName = c.req.param("worldName");
  const world = resolveWorld(worldName);
  if (!world) throw new HTTPError(404, "World not found");

  const hqParam = c.req.query("hq");
  const hq = hqParam === "true" ? true : hqParam === "false" ? false : undefined;

  const data = getListingsByItemAndWorld(db, itemId, world.id, hq);
  return c.json({ data, world: world.name });
}

export function priceHistory(c: Context<AppEnv>) {
  const db = c.get("db");
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) throw new HTTPError(400, "Invalid item ID");

  const period = c.req.query("period") ?? "7d";
  const resolution = (c.req.query("resolution") ?? "hourly") as "raw" | "hourly" | "daily";

  if (!PERIOD_HOURS[period]) {
    throw new HTTPError(400, `Invalid period. Allowed: ${Object.keys(PERIOD_HOURS).join(", ")}`);
  }
  if (!["raw", "hourly", "daily"].includes(resolution)) {
    throw new HTTPError(400, "Invalid resolution. Allowed: raw, hourly, daily");
  }

  const hours = PERIOD_HOURS[period]!;
  const since = new Date(Date.now() - hours * 3600000).toISOString();

  const data = getPriceHistory(db, itemId, { since, resolution });
  return c.json({ data, period, resolution });
}

export function recentSales(c: Context<AppEnv>) {
  const db = c.get("db");
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) throw new HTTPError(400, "Invalid item ID");

  const days = Math.min(90, Math.max(1, Number(c.req.query("days")) || 7));
  const worldParam = c.req.query("world");
  let worldId: number | undefined;

  if (worldParam) {
    const world = resolveWorld(worldParam);
    if (!world) throw new HTTPError(404, "World not found");
    worldId = world.id;
  }

  const data = getRecentSales(db, itemId, { days, worldId });
  return c.json({ data });
}
