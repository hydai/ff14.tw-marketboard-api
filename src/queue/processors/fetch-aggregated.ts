import type { Env, FetchAggregatedMessage } from "../../env";
import { KV_TTL_LATEST_PRICE } from "../../config/constants";
import { UniversalisClient } from "../../services/universalis";
import { KVCache } from "../../cache/kv";
import { batchInsert } from "../../db/batch";
import { createLogger } from "../../utils/logger";
import type { PriceSummary, UniversalisAggregatedItem } from "../../utils/types";
import { WORLDS_BY_ID } from "../../config/datacenters";

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

  for (const result of response.results) {
    try {
      await processAggregatedItem(env, cache, result, now);
    } catch (err) {
      log.error("Failed to process aggregated item", {
        itemId: result.itemId,
        error: String(err),
      });
    }
  }

  log.info("Fetch-aggregated complete", { itemCount: msg.itemIds.length });
}

async function processAggregatedItem(
  env: Env,
  cache: KVCache,
  result: UniversalisAggregatedItem,
  snapshotTime: string
): Promise<void> {
  const itemId = result.itemId;

  const minNQ = result.nq.minListing?.dc?.price ?? null;
  const minHQ = result.hq.minListing?.dc?.price ?? null;
  const avgNQ = result.nq.averageSalePrice?.dc?.price
    ? Math.round(result.nq.averageSalePrice.dc.price)
    : null;
  const avgHQ = result.hq.averageSalePrice?.dc?.price
    ? Math.round(result.hq.averageSalePrice.dc.price)
    : null;
  const velocityNQ = result.nq.dailySaleVelocity?.dc?.quantity ?? 0;
  const velocityHQ = result.hq.dailySaleVelocity?.dc?.quantity ?? 0;

  // Cheapest world: compare NQ and HQ, pick the lower price
  const nqWorldId = result.nq.minListing?.dc?.worldId ?? null;
  const hqWorldId = result.hq.minListing?.dc?.worldId ?? null;
  const nqPrice = minNQ ?? Infinity;
  const hqPrice = minHQ ?? Infinity;
  const cheapestWorldId = nqPrice <= hqPrice ? nqWorldId : hqWorldId;
  const cheapestWorldName = cheapestWorldId != null
    ? (WORLDS_BY_ID.get(cheapestWorldId)?.name ?? null)
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
      "cheapest_world_id", "cheapest_world_name",
    ],
    [[
      itemId,
      snapshotTime,
      minNQ,
      minHQ,
      avgNQ,
      avgHQ,
      0, // aggregated endpoint doesn't provide listing count
      0, // aggregated endpoint doesn't provide units_for_sale
      velocityNQ,
      velocityHQ,
      cheapestWorldId,
      cheapestWorldName,
    ]]
  );

  // Update KV cache with latest price summary
  const priceSummary: PriceSummary = {
    itemId,
    minPriceNQ: minNQ,
    minPriceHQ: minHQ,
    avgPriceNQ: avgNQ,
    avgPriceHQ: avgHQ,
    listingCount: 0,
    saleVelocityNQ: velocityNQ,
    saleVelocityHQ: velocityHQ,
    cheapestWorld: cheapestWorldName,
    lastUpdated: snapshotTime,
  };

  await cache.putJSON(KVCache.latestPriceKey(itemId), priceSummary, KV_TTL_LATEST_PRICE);
}
