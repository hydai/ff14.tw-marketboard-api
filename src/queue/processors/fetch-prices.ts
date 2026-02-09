import type { Env, FetchPricesMessage } from "../../env";
import { KV_TTL_LATEST_PRICE, KV_TTL_LISTINGS } from "../../config/constants";
import { UniversalisClient } from "../../services/universalis";
import { KVCache } from "../../cache/kv";
import { prepareBatchStatements } from "../../db/batch";
import { createLogger } from "../../utils/logger";
import { isTransientD1Error, withD1Retry } from "../../utils/retry";
import type { PriceSummary, UniversalisItemData, UniversalisListing, UniversalisSale } from "../../utils/types";
import { median } from "../../utils/math";

const log = createLogger("fetch-prices");

export async function processFetchPrices(
  msg: FetchPricesMessage,
  env: Env
): Promise<void> {
  const client = new UniversalisClient();
  const cache = new KVCache(env.KV);
  const now = new Date().toISOString();

  log.info("Processing fetch-prices", {
    itemCount: msg.itemIds.length,
    tier: msg.tier,
  });

  const response = await client.fetchMultiItemPrices(msg.itemIds);

  for (const itemIdStr of Object.keys(response.items)) {
    const itemData = response.items[itemIdStr]!;
    const itemId = itemData.itemID;

    try {
      await processItem(env, cache, itemId, itemData, now);
    } catch (err) {
      log.error("Failed to process item", {
        itemId,
        error: String(err),
      });
      if (isTransientD1Error(err)) {
        throw err;
      }
    }
  }

  log.info("Fetch-prices complete", { itemCount: msg.itemIds.length });
}

async function processItem(
  env: Env,
  cache: KVCache,
  itemId: number,
  data: UniversalisItemData,
  snapshotTime: string
): Promise<void> {
  // 1. KV read FIRST — needed to filter sales, no D1 dependency
  const lastSaleTs = data.recentHistory.length > 0
    ? await cache.getJSON<number>(KVCache.lastSaleTimestampKey(itemId))
    : null;
  const cutoff = lastSaleTs ?? 0;

  // 2. Compute derived values (pure data, no I/O)
  const dcNqListings = data.listings.filter((l) => !l.hq);
  const dcHqListings = data.listings.filter((l) => l.hq);
  const medianNQ = dcNqListings.length > 0
    ? Math.round(median(dcNqListings.map((l) => l.pricePerUnit)))
    : null;
  const medianHQ = dcHqListings.length > 0
    ? Math.round(median(dcHqListings.map((l) => l.pricePerUnit)))
    : null;

  const cheapestNQ = dcNqListings.length > 0
    ? dcNqListings.reduce((min, l) => l.pricePerUnit < min.pricePerUnit ? l : min)
    : undefined;
  const cheapestHQ = dcHqListings.length > 0
    ? dcHqListings.reduce((min, l) => l.pricePerUnit < min.pricePerUnit ? l : min)
    : undefined;
  const cheapestOverall = cheapestNQ && cheapestHQ
    ? (cheapestNQ.pricePerUnit <= cheapestHQ.pricePerUnit ? cheapestNQ : cheapestHQ)
    : cheapestNQ ?? cheapestHQ;

  // 3. Prepare all D1 statements (no execution yet)
  const stmts: D1PreparedStatement[] = [];

  // DELETE existing listings
  stmts.push(
    env.DB.prepare("DELETE FROM current_listings WHERE item_id = ?").bind(itemId)
  );

  // INSERT listings
  if (data.listings.length > 0) {
    const listingRows = data.listings.map((l: UniversalisListing) => [
      l.listingID,
      itemId,
      l.worldID,
      l.worldName,
      l.pricePerUnit,
      l.quantity,
      l.total,
      l.tax,
      l.hq ? 1 : 0,
      l.retainerName,
      l.retainerCity,
      l.creatorName,
      new Date(l.lastReviewTime * 1000).toISOString(),
      snapshotTime,
    ]);

    stmts.push(...prepareBatchStatements(
      env.DB,
      "current_listings",
      [
        "listing_id", "item_id", "world_id", "world_name",
        "price_per_unit", "quantity", "total", "tax",
        "hq", "retainer_name", "retainer_city", "creator_name",
        "last_review_time", "fetched_at",
      ],
      listingRows,
      "ON CONFLICT(item_id, world_id, listing_id) DO UPDATE SET price_per_unit = excluded.price_per_unit, quantity = excluded.quantity, total = excluded.total, fetched_at = excluded.fetched_at"
    ));
  }

  // INSERT price snapshot
  stmts.push(...prepareBatchStatements(
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
      data.minPriceNQ,
      data.minPriceHQ,
      medianNQ,
      medianHQ,
      data.listingsCount,
      data.unitsForSale,
      data.nqSaleVelocity,
      data.hqSaleVelocity,
      cheapestOverall?.worldID ?? null,
      cheapestOverall?.worldName ?? null,
    ]]
  ));

  // INSERT new sales (filtered by KV timestamp)
  if (data.recentHistory.length > 0) {
    const newSales = data.recentHistory.filter((s: UniversalisSale) => s.timestamp > cutoff);

    if (newSales.length > 0) {
      const saleRows = newSales.map((s: UniversalisSale) => [
        itemId,
        s.worldID,
        s.worldName,
        s.pricePerUnit,
        s.quantity,
        s.total,
        s.hq ? 1 : 0,
        s.buyerName,
        new Date(s.timestamp * 1000).toISOString(),
      ]);

      stmts.push(...prepareBatchStatements(
        env.DB,
        "sales_history",
        [
          "item_id", "world_id", "world_name",
          "price_per_unit", "quantity", "total",
          "hq", "buyer_name", "sold_at",
        ],
        saleRows,
        "ON CONFLICT DO NOTHING"
      ));
    }
  }

  // 4. Execute ALL D1 ops as a single subrequest
  await withD1Retry(() => env.DB.batch(stmts));

  // 5. KV writes
  if (data.recentHistory.length > 0) {
    const maxTs = Math.max(...data.recentHistory.map((s: UniversalisSale) => s.timestamp));
    if (maxTs > cutoff) {
      await cache.putJSON(KVCache.lastSaleTimestampKey(itemId), maxTs, KV_TTL_LATEST_PRICE);
    }
  }

  const priceSummary: PriceSummary = {
    itemId,
    minPriceNQ: data.minPriceNQ || null,
    minPriceHQ: data.minPriceHQ || null,
    avgPriceNQ: medianNQ,
    avgPriceHQ: medianHQ,
    listingCount: data.listingsCount,
    saleVelocityNQ: data.nqSaleVelocity,
    saleVelocityHQ: data.hqSaleVelocity,
    cheapestWorld: cheapestOverall?.worldName ?? null,
    lastUpdated: snapshotTime,
  };

  await cache.putJSON(KVCache.latestPriceKey(itemId), priceSummary, KV_TTL_LATEST_PRICE);

  const listingsCache = data.listings.map((l: UniversalisListing) => ({
    listingId: l.listingID,
    worldName: l.worldName,
    pricePerUnit: l.pricePerUnit,
    quantity: l.quantity,
    total: l.total,
    tax: l.tax,
    hq: l.hq,
    retainerName: l.retainerName,
    retainerCity: l.retainerCity,
    lastReviewTime: new Date(l.lastReviewTime * 1000).toISOString(),
  }));

  await cache.putJSON(KVCache.listingsKey(itemId), listingsCache, KV_TTL_LISTINGS);
}
