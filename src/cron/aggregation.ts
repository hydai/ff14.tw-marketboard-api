import { createLogger } from "../utils/logger";
import { setMeta } from "../db/queries";

const log = createLogger("aggregation");

export async function runAggregation(db: D1Database): Promise<void> {
  log.info("Starting hourly aggregation");
  const start = Date.now();

  // Aggregate recent snapshots into hourly_aggregates (last 70 minutes)
  // Only the most recent hour has new data; 70-min window provides safety margin for delayed crons
  const rollupHourly = await db
    .prepare(
      `INSERT OR REPLACE INTO hourly_aggregates
         (item_id, hour_timestamp, min_price_nq, avg_price_nq, max_price_nq,
          min_price_hq, avg_price_hq, max_price_hq,
          total_listings, total_sales, total_sales_gil)
       SELECT
         item_id,
         strftime('%Y-%m-%d %H:00:00', snapshot_time) AS hour_timestamp,
         MIN(min_price_nq),
         AVG(avg_price_nq),
         MAX(min_price_nq),
         MIN(min_price_hq),
         AVG(avg_price_hq),
         MAX(min_price_hq),
         SUM(listing_count),
         0,
         0
       FROM price_snapshots
       WHERE snapshot_time >= datetime('now', '-70 minutes')
       GROUP BY item_id, strftime('%Y-%m-%d %H:00:00', snapshot_time)`
    )
    .run();

  log.info("Hourly aggregation complete", {
    rowsWritten: rollupHourly.meta.rows_written,
  });

  await setMeta(db, "last_aggregation", new Date().toISOString());

  const elapsed = Date.now() - start;
  log.info("Aggregation completed", { elapsedMs: elapsed });
}
