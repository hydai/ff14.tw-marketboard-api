import type { Env, FetchPricesMessage } from "../../env";
import { KV_TTL_LATEST_PRICE, KV_TTL_LISTINGS } from "../../config/constants";
import { UniversalisClient } from "../../services/universalis";
import { KVCache } from "../../cache/kv";
import { batchInsert } from "../../db/batch";
import { deleteListingsForItem } from "../../db/queries";
import { createLogger } from "../../utils/logger";
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
  // 1. Delete existing listings and insert new ones
  await deleteListingsForItem(env.DB, itemId);

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

    await batchInsert(
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
    );
  }

  // 2. Insert DC-level price snapshot (median instead of Universalis mean)
  const dcNqListings = data.listings.filter((l) => !l.hq);
  const dcHqListings = data.listings.filter((l) => l.hq);
  const medianNQ = dcNqListings.length > 0
    ? Math.round(median(dcNqListings.map((l) => l.pricePerUnit)))
    : null;
  const medianHQ = dcHqListings.length > 0
    ? Math.round(median(dcHqListings.map((l) => l.pricePerUnit)))
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
      data.minPriceNQ,
      data.minPriceHQ,
      medianNQ,
      medianHQ,
      data.listingsCount,
      data.unitsForSale,
      data.nqSaleVelocity,
      data.hqSaleVelocity,
    ]]
  );

  // 3. Insert world-level price snapshots
  // Group listings by world to compute per-world aggregates
  const worldListings = new Map<number, UniversalisListing[]>();
  for (const listing of data.listings) {
    const existing = worldListings.get(listing.worldID) ?? [];
    existing.push(listing);
    worldListings.set(listing.worldID, existing);
  }

  if (worldListings.size > 0) {
    const worldRows: unknown[][] = [];
    for (const [worldId, listings] of worldListings) {
      const nqListings = listings.filter((l) => !l.hq);
      const hqListings = listings.filter((l) => l.hq);

      const minNQ = nqListings.length > 0
        ? Math.min(...nqListings.map((l) => l.pricePerUnit))
        : null;
      const minHQ = hqListings.length > 0
        ? Math.min(...hqListings.map((l) => l.pricePerUnit))
        : null;

      const avgNQ = nqListings.length > 0
        ? Math.round(median(nqListings.map((l) => l.pricePerUnit)))
        : null;
      const avgHQ = hqListings.length > 0
        ? Math.round(median(hqListings.map((l) => l.pricePerUnit)))
        : null;

      worldRows.push([
        itemId,
        worldId,
        listings[0]!.worldName,
        snapshotTime,
        minNQ,
        minHQ,
        avgNQ,
        avgHQ,
        listings.length,
      ]);
    }

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

  // 4. Insert sales history (dedup via ON CONFLICT IGNORE)
  if (data.recentHistory.length > 0) {
    const saleRows = data.recentHistory.map((s: UniversalisSale) => [
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

    await batchInsert(
      env.DB,
      "sales_history",
      [
        "item_id", "world_id", "world_name",
        "price_per_unit", "quantity", "total",
        "hq", "buyer_name", "sold_at",
      ],
      saleRows,
      "ON CONFLICT DO NOTHING"
    );
  }

  // 5. Update KV cache with latest price summary
  const cheapestNQ = data.listings
    .filter((l) => !l.hq)
    .sort((a, b) => a.pricePerUnit - b.pricePerUnit)[0];

  const priceSummary: PriceSummary = {
    itemId,
    minPriceNQ: data.minPriceNQ || null,
    minPriceHQ: data.minPriceHQ || null,
    avgPriceNQ: medianNQ,
    avgPriceHQ: medianHQ,
    listingCount: data.listingsCount,
    saleVelocityNQ: data.nqSaleVelocity,
    saleVelocityHQ: data.hqSaleVelocity,
    cheapestWorld: cheapestNQ?.worldName ?? null,
    lastUpdated: snapshotTime,
  };

  await cache.putJSON(KVCache.latestPriceKey(itemId), priceSummary, KV_TTL_LATEST_PRICE);

  // 6. Update KV cache with listings
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
