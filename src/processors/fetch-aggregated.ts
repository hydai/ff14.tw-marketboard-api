import type Database from "better-sqlite3";
import { UniversalisClient } from "../services/universalis.js";
import { createLogger } from "../utils/logger.js";
import type { UniversalisAggregatedItem } from "../utils/types.js";

const log = createLogger("fetch-aggregated");

export async function processFetchAggregated(
  db: Database.Database,
  itemIds: number[],
): Promise<void> {
  const client = new UniversalisClient();
  const now = new Date().toISOString();

  log.info("Processing fetch-aggregated", { itemCount: itemIds.length });

  const response = await client.fetchAggregated(itemIds);

  for (const result of response.results) {
    try {
      processAggregatedItem(db, result, now);
    } catch (err) {
      log.error("Failed to process aggregated item", {
        itemId: result.itemId,
        error: String(err),
      });
    }
  }

  log.info("Fetch-aggregated complete", { itemCount: itemIds.length });
}

function processAggregatedItem(
  db: Database.Database,
  result: UniversalisAggregatedItem,
  snapshotTime: string,
): void {
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

  // Deduplicate: skip insert if key fields unchanged from last snapshot
  const lastSnap = db.prepare(
    `SELECT min_price_nq, min_price_hq, listing_count, units_for_sale
     FROM price_snapshots WHERE item_id = ? ORDER BY snapshot_time DESC LIMIT 1`
  ).get(itemId) as { min_price_nq: number | null; min_price_hq: number | null; listing_count: number; units_for_sale: number } | undefined;

  const snapUnchanged = lastSnap
    && lastSnap.min_price_nq === minNQ
    && lastSnap.min_price_hq === minHQ
    && lastSnap.listing_count === 0
    && lastSnap.units_for_sale === 0;

  if (!snapUnchanged) {
    db.prepare(
      `INSERT INTO price_snapshots
       (item_id, snapshot_time, min_price_nq, min_price_hq,
        avg_price_nq, avg_price_hq, listing_count, units_for_sale,
        sale_velocity_nq, sale_velocity_hq, cheapest_world_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      itemId, snapshotTime,
      minNQ, minHQ,
      avgNQ, avgHQ,
      0, 0,
      velocityNQ, velocityHQ,
      cheapestWorldId,
    );
  }
}
