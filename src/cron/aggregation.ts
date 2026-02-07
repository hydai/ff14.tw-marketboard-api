import { createLogger } from "../utils/logger";
import { setMeta } from "../db/queries";

const log = createLogger("aggregation");

export async function runAggregation(db: D1Database): Promise<void> {
  log.info("Starting hourly aggregation");
  const start = Date.now();

  // Step 1: Aggregate recent snapshots into hourly_aggregates (last 25 hours)
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
       WHERE snapshot_time >= datetime('now', '-25 hours')
       GROUP BY item_id, strftime('%Y-%m-%d %H:00:00', snapshot_time)`
    )
    .run();

  log.info("Hourly aggregation complete", {
    rowsWritten: rollupHourly.meta.rows_written,
  });

  // Step 2: Aggregate completed days from hourly_aggregates into daily_aggregates
  // Only aggregate days strictly before today (UTC) to avoid partial-day data
  const rollupDaily = await db
    .prepare(
      `INSERT OR REPLACE INTO daily_aggregates
         (item_id, day_timestamp, min_price_nq, avg_price_nq, max_price_nq,
          min_price_hq, avg_price_hq, max_price_hq,
          total_listings, total_sales, total_sales_gil)
       SELECT
         item_id,
         date(hour_timestamp) AS day_timestamp,
         MIN(min_price_nq),
         AVG(avg_price_nq),
         MAX(max_price_nq),
         MIN(min_price_hq),
         AVG(avg_price_hq),
         MAX(max_price_hq),
         SUM(total_listings),
         SUM(total_sales),
         SUM(total_sales_gil)
       FROM hourly_aggregates
       WHERE date(hour_timestamp) < date('now')
       GROUP BY item_id, date(hour_timestamp)`
    )
    .run();

  log.info("Daily aggregation complete", {
    rowsWritten: rollupDaily.meta.rows_written,
  });

  await setMeta(db, "last_aggregation", new Date().toISOString());

  const elapsed = Date.now() - start;
  log.info("Aggregation completed", { elapsedMs: elapsed });
}
