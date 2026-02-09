import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";
import { setMeta } from "../db/queries.js";
import { isoTimeAgo } from "../utils/datetime.js";

const log = createLogger("aggregation");

export function runAggregation(db: Database.Database): void {
  log.info("Starting hourly aggregation");
  const start = Date.now();

  const snapshotCutoff = isoTimeAgo(70 / 60);

  const rollupHourly = db
    .prepare(
      `INSERT INTO hourly_aggregates
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
       WHERE snapshot_time >= ?
       GROUP BY item_id, strftime('%Y-%m-%d %H:00:00', snapshot_time)
       ON CONFLICT(item_id, hour_timestamp) DO UPDATE SET
         min_price_nq = excluded.min_price_nq,
         avg_price_nq = excluded.avg_price_nq,
         max_price_nq = excluded.max_price_nq,
         min_price_hq = excluded.min_price_hq,
         avg_price_hq = excluded.avg_price_hq,
         max_price_hq = excluded.max_price_hq,
         total_listings = excluded.total_listings,
         total_sales = excluded.total_sales,
         total_sales_gil = excluded.total_sales_gil
       WHERE
         hourly_aggregates.min_price_nq IS NOT excluded.min_price_nq
         OR hourly_aggregates.avg_price_nq IS NOT excluded.avg_price_nq
         OR hourly_aggregates.max_price_nq IS NOT excluded.max_price_nq
         OR hourly_aggregates.min_price_hq IS NOT excluded.min_price_hq
         OR hourly_aggregates.avg_price_hq IS NOT excluded.avg_price_hq
         OR hourly_aggregates.max_price_hq IS NOT excluded.max_price_hq
         OR hourly_aggregates.total_listings IS NOT excluded.total_listings
         OR hourly_aggregates.total_sales IS NOT excluded.total_sales
         OR hourly_aggregates.total_sales_gil IS NOT excluded.total_sales_gil`
    )
    .run(snapshotCutoff);

  log.info("Hourly aggregation complete", {
    rowsWritten: rollupHourly.changes,
  });

  setMeta(db, "last_aggregation", new Date().toISOString());

  const elapsed = Date.now() - start;
  log.info("Aggregation completed", { elapsedMs: elapsed });
}
