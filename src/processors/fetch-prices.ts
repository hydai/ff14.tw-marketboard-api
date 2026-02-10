import type Database from "better-sqlite3";
import { UniversalisClient } from "../services/universalis.js";
import { createLogger } from "../utils/logger.js";
import type { UniversalisItemData, UniversalisSale } from "../utils/types.js";
import { median } from "../utils/math.js";

const log = createLogger("fetch-prices");

export async function processFetchPrices(
  db: Database.Database,
  itemIds: number[],
  tier: 1 | 2 | 3,
): Promise<void> {
  const client = new UniversalisClient();
  const now = new Date().toISOString();

  log.info("Processing fetch-prices", {
    itemCount: itemIds.length,
    tier,
  });

  const response = await client.fetchMultiItemPrices(itemIds);

  for (const itemIdStr of Object.keys(response.items)) {
    const itemData = response.items[itemIdStr]!;
    const itemId = itemData.itemID;

    try {
      processItem(db, itemId, itemData, now);
    } catch (err) {
      log.error("Failed to process item", {
        itemId,
        error: String(err),
      });
    }
  }

  log.info("Fetch-prices complete", { itemCount: itemIds.length });
}

function processItem(
  db: Database.Database,
  itemId: number,
  data: UniversalisItemData,
  snapshotTime: string,
): void {
  // 1. Get last sale timestamp from DB instead of KV
  const lastSaleRow = data.recentHistory.length > 0
    ? db.prepare("SELECT MAX(sold_at) as last_ts FROM sales_history WHERE item_id = ?").get(itemId) as { last_ts: string | null } | undefined
    : null;
  const cutoffDate = lastSaleRow?.last_ts ?? null;
  // Convert ISO date to unix timestamp for comparison with Universalis data
  const cutoff = cutoffDate ? Math.floor(new Date(cutoffDate).getTime() / 1000) : 0;

  // 2. Compute derived values
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

  // 3. Execute all DB ops in a single transaction
  const runAll = db.transaction(() => {
    // DELETE existing listings
    db.prepare("DELETE FROM current_listings WHERE item_id = ?").run(itemId);

    // INSERT listings
    if (data.listings.length > 0) {
      const listingStmt = db.prepare(
        `INSERT INTO current_listings
         (listing_id, item_id, world_id, price_per_unit, quantity, total, tax,
          hq, retainer_name, retainer_city, last_review_time, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const l of data.listings) {
        listingStmt.run(
          l.listingID, itemId, l.worldID,
          l.pricePerUnit, l.quantity, l.total, l.tax,
          l.hq ? 1 : 0, l.retainerName, l.retainerCity,
          new Date(l.lastReviewTime * 1000).toISOString(), snapshotTime,
        );
      }
    }

    // INSERT price snapshot (deduplicated: skip if key fields unchanged)
    const lastSnap = db.prepare(
      `SELECT min_price_nq, min_price_hq, listing_count, units_for_sale
       FROM price_snapshots WHERE item_id = ? ORDER BY snapshot_time DESC LIMIT 1`
    ).get(itemId) as { min_price_nq: number | null; min_price_hq: number | null; listing_count: number; units_for_sale: number } | undefined;

    const snapUnchanged = lastSnap
      && lastSnap.min_price_nq === data.minPriceNQ
      && lastSnap.min_price_hq === data.minPriceHQ
      && lastSnap.listing_count === data.listingsCount
      && lastSnap.units_for_sale === data.unitsForSale;

    if (!snapUnchanged) {
      db.prepare(
        `INSERT INTO price_snapshots
         (item_id, snapshot_time, min_price_nq, min_price_hq,
          avg_price_nq, avg_price_hq, listing_count, units_for_sale,
          sale_velocity_nq, sale_velocity_hq, cheapest_world_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        itemId, snapshotTime,
        data.minPriceNQ, data.minPriceHQ,
        medianNQ, medianHQ,
        data.listingsCount, data.unitsForSale,
        data.nqSaleVelocity, data.hqSaleVelocity,
        cheapestOverall?.worldID ?? null,
      );
    }

    // INSERT new sales (filtered by last sale timestamp)
    if (data.recentHistory.length > 0) {
      const newSales = data.recentHistory.filter((s: UniversalisSale) => s.timestamp > cutoff);

      if (newSales.length > 0) {
        const saleStmt = db.prepare(
          `INSERT INTO sales_history
           (item_id, world_id, price_per_unit, quantity, total, hq, buyer_name, sold_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT DO NOTHING`
        );

        for (const s of newSales) {
          saleStmt.run(
            itemId, s.worldID,
            s.pricePerUnit, s.quantity, s.total,
            s.hq ? 1 : 0, s.buyerName,
            new Date(s.timestamp * 1000).toISOString(),
          );
        }
      }
    }
  });

  runAll();
}
