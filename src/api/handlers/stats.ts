import { Context } from "hono";
import type { Env } from "../../env";
import { KVCache } from "../../cache/kv";
import { DC_LUHANGNIAO } from "../../config/datacenters";
import { getMeta } from "../../db/queries";
import { getCollectionStats } from "../../db/stats";

const KV_TTL_STATS = 60; // 1 minute cache
const STATS_CACHE_KEY = "system:stats";

export async function getStats(c: Context<{ Bindings: Env }>) {
  const cache = new KVCache(c.env.KV);

  const cached = await cache.getJSON<CollectionStats>(STATS_CACHE_KEY);
  if (cached) {
    return c.json({ ...cached, cached: true });
  }

  const [stats, lastPoll, lastMaintenance, lastItemSync] = await Promise.all([
    getCollectionStats(c.env.DB),
    getMeta(c.env.DB, "last_poll_time"),
    getMeta(c.env.DB, "last_maintenance"),
    getMeta(c.env.DB, "last_item_sync"),
  ]);

  const result: CollectionStats = {
    datacenter: DC_LUHANGNIAO.name,
    generatedAt: new Date().toISOString(),
    system: {
      lastPollTime: lastPoll?.value ?? null,
      lastMaintenance: lastMaintenance?.value ?? null,
      lastItemSync: lastItemSync?.value ?? null,
    },
    tables: stats.tables,
    tiers: stats.tiers,
    freshness: stats.freshness,
  };

  await cache.putJSON(STATS_CACHE_KEY, result, KV_TTL_STATS);

  return c.json({ ...result, cached: false });
}

interface CollectionStats {
  datacenter: string;
  generatedAt: string;
  system: {
    lastPollTime: string | null;
    lastMaintenance: string | null;
    lastItemSync: string | null;
  };
  tables: {
    items: number;
    currentListings: number;
    priceSnapshots: number;
    worldPriceSnapshots: number;
    salesHistory: number;
    hourlyAggregates: number;
    dailyAggregates: number;
    itemTiers: number;
  };
  tiers: {
    tier1: number;
    tier2: number;
    tier3: number;
  };
  freshness: {
    itemsWithRecentSnapshots: number;
    oldestSnapshotAge: string | null;
    newestSnapshotAge: string | null;
    itemsWithListings: number;
  };
}
