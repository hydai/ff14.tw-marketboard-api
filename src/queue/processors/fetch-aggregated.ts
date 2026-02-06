import type { Env, FetchAggregatedMessage } from "../../env";
import { KV_TTL_LATEST_PRICE } from "../../config/constants";
import { UniversalisClient } from "../../services/universalis";
import { KVCache } from "../../cache/kv";
import { batchInsert } from "../../db/batch";
import { createLogger } from "../../utils/logger";
import type { PriceSummary, UniversalisAggregatedItem } from "../../utils/types";

const log = createLogger("fetch-aggregated");

export async function processFetchAggregated(
  msg: FetchAggregatedMessage,
  env: Env
): Promise<void> {
  const client = new UniversalisClient();
  const cache = new KVCache(env.KV);
  const now = new Date().toISOString();

  log.info("Processing fetch-aggregated", { itemCount: msg.itemIds.length });

  const response = await client.fetchAggregated(msg.itemIds);

  // Group results by itemID to build DC-level and world-level snapshots
  const byItem = new Map<number, UniversalisAggregatedItem[]>();
  for (const result of response.results) {
    const existing = byItem.get(result.itemID) ?? [];
    existing.push(result);
    byItem.set(result.itemID, existing);
  }

  for (const [itemId, worldResults] of byItem) {
    try {
      await processAggregatedItem(env, cache, itemId, worldResults, now);
    } catch (err) {
      log.error("Failed to process aggregated item", {
        itemId,
        error: String(err),
      });
    }
  }

  log.info("Fetch-aggregated complete", { itemCount: msg.itemIds.length });
}

async function processAggregatedItem(
  env: Env,
  cache: KVCache,
  itemId: number,
  worldResults: UniversalisAggregatedItem[],
  snapshotTime: string
): Promise<void> {
  // Compute DC-level aggregates from world-level data
  let dcMinNQ: number | null = null;
  let dcMinHQ: number | null = null;
  let dcTotalListings = 0;
  let cheapestWorldName: string | null = null;

  const worldRows: unknown[][] = [];

  for (const wr of worldResults) {
    const minNQ = wr.nq.minListing?.price ?? null;
    const minHQ = wr.hq.minListing?.price ?? null;
    const avgNQ = wr.nq.recentHistory.count > 0 ? Math.round(wr.nq.recentHistory.avg) : null;
    const avgHQ = wr.hq.recentHistory.count > 0 ? Math.round(wr.hq.recentHistory.avg) : null;
    const listingCount = wr.nq.listings.count + wr.hq.listings.count;

    dcTotalListings += listingCount;

    if (minNQ !== null && (dcMinNQ === null || minNQ < dcMinNQ)) {
      dcMinNQ = minNQ;
      cheapestWorldName = wr.worldName;
    }
    if (minHQ !== null && (dcMinHQ === null || minHQ < dcMinHQ)) {
      dcMinHQ = minHQ;
    }

    worldRows.push([
      itemId,
      wr.worldID,
      wr.worldName,
      snapshotTime,
      minNQ,
      minHQ,
      avgNQ,
      avgHQ,
      listingCount,
    ]);
  }

  // Insert DC-level price snapshot
  // Compute DC-level averages from world data
  const nqWorlds = worldResults.filter((w) => w.nq.recentHistory.count > 0);
  const hqWorlds = worldResults.filter((w) => w.hq.recentHistory.count > 0);
  const dcAvgNQ = nqWorlds.length > 0
    ? Math.round(nqWorlds.reduce((s, w) => s + w.nq.recentHistory.avg, 0) / nqWorlds.length)
    : null;
  const dcAvgHQ = hqWorlds.length > 0
    ? Math.round(hqWorlds.reduce((s, w) => s + w.hq.recentHistory.avg, 0) / hqWorlds.length)
    : null;

  await batchInsert(
    env.DB,
    "price_snapshots",
    [
      "item_id", "snapshot_time",
      "min_price_nq", "min_price_hq",
      "avg_price_nq", "avg_price_hq",
      "listing_count", "units_for_sale",
      "sale_velocity_nq", "sale_velocity_hq",
    ],
    [[
      itemId,
      snapshotTime,
      dcMinNQ,
      dcMinHQ,
      dcAvgNQ,
      dcAvgHQ,
      dcTotalListings,
      0, // aggregated endpoint doesn't provide units_for_sale
      0, // aggregated endpoint doesn't provide sale velocity
      0,
    ]]
  );

  // Insert world-level price snapshots
  if (worldRows.length > 0) {
    await batchInsert(
      env.DB,
      "world_price_snapshots",
      [
        "item_id", "world_id", "world_name", "snapshot_time",
        "min_price_nq", "min_price_hq",
        "avg_price_nq", "avg_price_hq",
        "listing_count",
      ],
      worldRows
    );
  }

  // Update KV cache with latest price summary
  const priceSummary: PriceSummary = {
    itemId,
    minPriceNQ: dcMinNQ,
    minPriceHQ: dcMinHQ,
    avgPriceNQ: dcAvgNQ,
    avgPriceHQ: dcAvgHQ,
    listingCount: dcTotalListings,
    saleVelocityNQ: 0,
    saleVelocityHQ: 0,
    cheapestWorld: cheapestWorldName,
    lastUpdated: snapshotTime,
  };

  await cache.putJSON(KVCache.latestPriceKey(itemId), priceSummary, KV_TTL_LATEST_PRICE);
}
