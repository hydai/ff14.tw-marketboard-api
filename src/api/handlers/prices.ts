import { Context } from "hono";
import type { Env } from "../../env";
import { KVCache } from "../../cache/kv";
import {
  getListingsByItem,
  getListingsByItemAndWorld,
  getPriceHistory,
  getRecentSales,
} from "../../db/queries";
import { resolveWorld } from "../../config/datacenters";
import { HTTPError } from "../middleware";

const PERIOD_HOURS: Record<string, number> = {
  "1d": 24,
  "3d": 72,
  "7d": 168,
  "14d": 336,
  "30d": 720,
  "90d": 2160,
};

export async function getListings(c: Context<{ Bindings: Env }>) {
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) throw new HTTPError(400, "Invalid item ID");

  const hqParam = c.req.query("hq");
  const hq = hqParam === "true" ? true : hqParam === "false" ? false : undefined;

  // KV cache first
  const kv = new KVCache(c.env.KV);
  const cached = await kv.getJSON(KVCache.listingsKey(itemId));
  if (cached && hq === undefined) {
    return c.json({ data: cached });
  }

  // Fallback to D1
  const result = await getListingsByItem(c.env.DB, itemId, hq);
  return c.json({ data: result.results });
}

export async function getWorldListings(c: Context<{ Bindings: Env }>) {
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) throw new HTTPError(400, "Invalid item ID");

  const worldName = c.req.param("worldName");
  const world = resolveWorld(worldName);
  if (!world) throw new HTTPError(404, "World not found");

  const hqParam = c.req.query("hq");
  const hq = hqParam === "true" ? true : hqParam === "false" ? false : undefined;

  const result = await getListingsByItemAndWorld(c.env.DB, itemId, world.id, hq);
  return c.json({ data: result.results, world: world.name });
}

export async function priceHistory(c: Context<{ Bindings: Env }>) {
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

  const result = await getPriceHistory(c.env.DB, itemId, { since, resolution });
  return c.json({ data: result.results, period, resolution });
}

export async function recentSales(c: Context<{ Bindings: Env }>) {
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

  const result = await getRecentSales(c.env.DB, itemId, { days, worldId });
  return c.json({ data: result.results });
}
