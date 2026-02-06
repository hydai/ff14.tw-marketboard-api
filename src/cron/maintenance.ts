import { createLogger } from "../utils/logger";
import { setMeta } from "../db/queries";
import {
  RETENTION_RAW_SNAPSHOTS,
  RETENTION_HOURLY_AGGREGATES,
  RETENTION_DAILY_AGGREGATES,
} from "../config/constants";

const log = createLogger("maintenance");

export async function runMaintenance(db: D1Database): Promise<void> {
  log.info("Starting daily maintenance");
  const start = Date.now();

  const snapshotCutoff = `datetime('now', '-${RETENTION_RAW_SNAPSHOTS} days')`;
  const hourlyCutoff = `datetime('now', '-${RETENTION_HOURLY_AGGREGATES} days')`;
  const dailyCutoff = `datetime('now', '-${RETENTION_DAILY_AGGREGATES} days')`;
  const salesCutoff = `datetime('now', '-${RETENTION_HOURLY_AGGREGATES} days')`;
  const worldSnapshotCutoff = `datetime('now', '-${RETENTION_RAW_SNAPSHOTS} days')`;

  // Step 1: Roll up old price_snapshots into hourly_aggregates
  const rollupHourly = await db
    .prepare(
      `INSERT OR REPLACE INTO hourly_aggregates (item_id, hour_timestamp, min_price_nq, avg_price_nq, max_price_nq, min_price_hq, avg_price_hq, max_price_hq, total_listings, total_sales, total_sales_gil)
       SELECT
         item_id,
         strftime('%Y-%m-%d %H:00:00', snapshot_time) as hour_timestamp,
         MIN(min_price_nq) as min_price_nq,
         AVG(avg_price_nq) as avg_price_nq,
         MAX(min_price_nq) as max_price_nq,
         MIN(min_price_hq) as min_price_hq,
         AVG(avg_price_hq) as avg_price_hq,
         MAX(min_price_hq) as max_price_hq,
         SUM(listing_count) as total_listings,
         0 as total_sales,
         0 as total_sales_gil
       FROM price_snapshots
       WHERE snapshot_time < ${snapshotCutoff}
       GROUP BY item_id, strftime('%Y-%m-%d %H:00:00', snapshot_time)`
    )
    .run();

  log.info("Rolled up snapshots to hourly", {
    rowsWritten: rollupHourly.meta.rows_written,
  });

  // Delete the rolled-up snapshots
  const deleteSnapshots = await db
    .prepare(`DELETE FROM price_snapshots WHERE snapshot_time < ${snapshotCutoff}`)
    .run();

  log.info("Deleted old price_snapshots", {
    rowsDeleted: deleteSnapshots.meta.rows_written,
  });

  // Step 2: Roll up old hourly_aggregates into daily_aggregates
  const rollupDaily = await db
    .prepare(
      `INSERT OR REPLACE INTO daily_aggregates (item_id, day_timestamp, min_price_nq, avg_price_nq, max_price_nq, min_price_hq, avg_price_hq, max_price_hq, total_listings, total_sales, total_sales_gil)
       SELECT
         item_id,
         date(hour_timestamp) as day_timestamp,
         MIN(min_price_nq) as min_price_nq,
         AVG(avg_price_nq) as avg_price_nq,
         MAX(max_price_nq) as max_price_nq,
         MIN(min_price_hq) as min_price_hq,
         AVG(avg_price_hq) as avg_price_hq,
         MAX(max_price_hq) as max_price_hq,
         SUM(total_listings) as total_listings,
         SUM(total_sales) as total_sales,
         SUM(total_sales_gil) as total_sales_gil
       FROM hourly_aggregates
       WHERE hour_timestamp < ${hourlyCutoff}
       GROUP BY item_id, date(hour_timestamp)`
    )
    .run();

  log.info("Rolled up hourly to daily", {
    rowsWritten: rollupDaily.meta.rows_written,
  });

  // Delete the rolled-up hourly aggregates
  const deleteHourly = await db
    .prepare(`DELETE FROM hourly_aggregates WHERE hour_timestamp < ${hourlyCutoff}`)
    .run();

  log.info("Deleted old hourly_aggregates", {
    rowsDeleted: deleteHourly.meta.rows_written,
  });

  // Step 3: Delete old daily_aggregates
  const deleteDaily = await db
    .prepare(`DELETE FROM daily_aggregates WHERE day_timestamp < ${dailyCutoff}`)
    .run();

  log.info("Deleted old daily_aggregates", {
    rowsDeleted: deleteDaily.meta.rows_written,
  });

  // Step 4: Delete old world_price_snapshots
  const deleteWorldSnapshots = await db
    .prepare(`DELETE FROM world_price_snapshots WHERE snapshot_time < ${worldSnapshotCutoff}`)
    .run();

  log.info("Deleted old world_price_snapshots", {
    rowsDeleted: deleteWorldSnapshots.meta.rows_written,
  });

  // Step 5: Delete old sales_history
  const deleteSales = await db
    .prepare(`DELETE FROM sales_history WHERE sold_at < ${salesCutoff}`)
    .run();

  log.info("Deleted old sales_history", {
    rowsDeleted: deleteSales.meta.rows_written,
  });

  // Step 6: Update system_meta
  await setMeta(db, "last_maintenance", new Date().toISOString());

  const elapsed = Date.now() - start;
  log.info("Maintenance completed", { elapsedMs: elapsed });
}
