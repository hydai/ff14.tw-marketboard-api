import { Context } from "hono";
import type { Env } from "../../env";
import {
  DEALS_MAX_PERCENTILE,
  DEFAULT_PAGE_SIZE,
  KV_TTL_ANALYTICS,
  MAX_PAGE_SIZE,
} from "../../config/constants";
import { KVCache } from "../../cache/kv";
import { getDeals } from "../../db/queries";
import { resolveWorld } from "../../config/datacenters";
import { HTTPError } from "../middleware";

export async function listDeals(c: Context<{ Bindings: Env }>) {
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

  // KV cache first (only for default params with no filters)
  const kv = new KVCache(c.env.KV);
  if (!category && !worldId && maxPercentile === DEALS_MAX_PERCENTILE) {
    const cached = await kv.getJSON(KVCache.dealsKey());
    if (cached) {
      return c.json({ data: cached });
    }
  }

  const result = await getDeals(c.env.DB, {
    maxPercentile,
    category,
    worldId,
    limit,
  });

  // Cache default results
  if (!category && !worldId && maxPercentile === DEALS_MAX_PERCENTILE) {
    await kv.putJSON(KVCache.dealsKey(), result.results, KV_TTL_ANALYTICS);
  }

  return c.json({ data: result.results });
}
