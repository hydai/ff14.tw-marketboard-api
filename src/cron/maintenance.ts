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

  // Step 1: Delete old price_snapshots
  const deleteSnapshots = await db
    .prepare(`DELETE FROM price_snapshots WHERE snapshot_time < ${snapshotCutoff}`)
    .run();

  log.info("Deleted old price_snapshots", {
    rowsDeleted: deleteSnapshots.meta.rows_written,
  });

  // Step 2: Delete old hourly_aggregates
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

  // Step 4: Delete old sales_history
  const deleteSales = await db
    .prepare(`DELETE FROM sales_history WHERE sold_at < ${salesCutoff}`)
    .run();

  log.info("Deleted old sales_history", {
    rowsDeleted: deleteSales.meta.rows_written,
  });

  // Step 5: Daily aggregation — roll up hourly into daily_aggregates
  // Only completed days (before today); older days are already finalized
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
         AND date(hour_timestamp) >= date('now', '-2 days')
       GROUP BY item_id, date(hour_timestamp)`
    )
    .run();

  log.info("Daily aggregation complete", {
    rowsWritten: rollupDaily.meta.rows_written,
  });

  // Step 6: Reclassify item tiers based on 7-day sales velocity
  await db
    .prepare(
      `INSERT OR REPLACE INTO item_tiers (item_id, tier, updated_at)
       SELECT
         item_id,
         CASE
           WHEN daily_sales > 10 THEN 1
           WHEN daily_sales >= 2 THEN 2
           ELSE 3
         END as tier,
         datetime('now') as updated_at
       FROM (
         SELECT item_id, COUNT(*) * 1.0 / 7 as daily_sales
         FROM sales_history
         WHERE sold_at >= datetime('now', '-7 days')
         GROUP BY item_id
       )`
    )
    .run();

  // Bootstrap tiers from Universalis velocity data for cold-start
  await db
    .prepare(
      `INSERT OR REPLACE INTO item_tiers (item_id, tier, updated_at)
       SELECT
         item_id,
         CASE
           WHEN total_velocity > 10 THEN 1
           WHEN total_velocity >= 2 THEN 2
           ELSE 3
         END as tier,
         datetime('now') as updated_at
       FROM (
         SELECT
           item_id,
           AVG(sale_velocity_nq + sale_velocity_hq) as total_velocity
         FROM price_snapshots
         WHERE snapshot_time >= datetime('now', '-1 day')
         GROUP BY item_id
         HAVING total_velocity >= 2
       )
       WHERE item_id IN (SELECT item_id FROM item_tiers WHERE tier = 3)`
    )
    .run();

  log.info("Reclassified item tiers");

  // Step 7: Update system_meta
  await setMeta(db, "last_maintenance", new Date().toISOString());

  const elapsed = Date.now() - start;
  log.info("Maintenance completed", { elapsedMs: elapsed });
}
