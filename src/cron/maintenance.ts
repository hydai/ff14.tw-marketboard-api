import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";
import { setMeta } from "../db/queries.js";
import { isoTimeAgo } from "../utils/datetime.js";
import {
  RETENTION_RAW_SNAPSHOTS,
  RETENTION_HOURLY_AGGREGATES,
  RETENTION_DAILY_AGGREGATES,
} from "../config/constants.js";

const log = createLogger("maintenance");

export function runMaintenance(db: Database.Database): void {
  log.info("Starting daily maintenance");
  const start = Date.now();

  // snapshot_time and sold_at use ISO 8601 format (from toISOString())
  const snapshotCutoff = isoTimeAgo(RETENTION_RAW_SNAPSHOTS * 24);
  const salesCutoff = isoTimeAgo(RETENTION_HOURLY_AGGREGATES * 24);
  // hour_timestamp and day_timestamp use space-separated format (from strftime())
  // so datetime() is correct for those comparisons
  const hourlyCutoff = `datetime('now', '-${RETENTION_HOURLY_AGGREGATES} days')`;
  const dailyCutoff = `datetime('now', '-${RETENTION_DAILY_AGGREGATES} days')`;

  // Step 1: Delete old price_snapshots
  const deleteSnapshots = db
    .prepare("DELETE FROM price_snapshots WHERE snapshot_time < ?")
    .run(snapshotCutoff);

  log.info("Deleted old price_snapshots", {
    rowsDeleted: deleteSnapshots.changes,
  });

  // Step 2: Delete old hourly_aggregates
  const deleteHourly = db
    .prepare(`DELETE FROM hourly_aggregates WHERE hour_timestamp < ${hourlyCutoff}`)
    .run();

  log.info("Deleted old hourly_aggregates", {
    rowsDeleted: deleteHourly.changes,
  });

  // Step 3: Delete old daily_aggregates
  const deleteDaily = db
    .prepare(`DELETE FROM daily_aggregates WHERE day_timestamp < ${dailyCutoff}`)
    .run();

  log.info("Deleted old daily_aggregates", {
    rowsDeleted: deleteDaily.changes,
  });

  // Step 4: Delete old sales_history
  const deleteSales = db
    .prepare("DELETE FROM sales_history WHERE sold_at < ?")
    .run(salesCutoff);

  log.info("Deleted old sales_history", {
    rowsDeleted: deleteSales.changes,
  });

  // Step 5: Daily aggregation — roll up hourly into daily_aggregates
  const rollupDaily = db
    .prepare(
      `INSERT INTO daily_aggregates
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
         AND date(hour_timestamp) >= date('now', '-1 day')
       GROUP BY item_id, date(hour_timestamp)
       ON CONFLICT(item_id, day_timestamp) DO UPDATE SET
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
         daily_aggregates.min_price_nq IS NOT excluded.min_price_nq
         OR daily_aggregates.avg_price_nq IS NOT excluded.avg_price_nq
         OR daily_aggregates.max_price_nq IS NOT excluded.max_price_nq
         OR daily_aggregates.min_price_hq IS NOT excluded.min_price_hq
         OR daily_aggregates.avg_price_hq IS NOT excluded.avg_price_hq
         OR daily_aggregates.max_price_hq IS NOT excluded.max_price_hq
         OR daily_aggregates.total_listings IS NOT excluded.total_listings
         OR daily_aggregates.total_sales IS NOT excluded.total_sales
         OR daily_aggregates.total_sales_gil IS NOT excluded.total_sales_gil`
    )
    .run();

  log.info("Daily aggregation complete", {
    rowsWritten: rollupDaily.changes,
  });

  // Step 6: Reclassify item tiers based on 7-day sales velocity
  const salesWindow = isoTimeAgo(7 * 24);
  db.prepare(
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
       WHERE sold_at >= ?
       GROUP BY item_id
     )`
  ).run(salesWindow);

  // Bootstrap tiers from Universalis velocity data for cold-start
  const recentSnapshots = isoTimeAgo(24);
  db.prepare(
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
       WHERE snapshot_time >= ?
       GROUP BY item_id
       HAVING total_velocity >= 2
     )
     WHERE item_id IN (SELECT item_id FROM item_tiers WHERE tier = 3)`
  ).run(recentSnapshots);

  log.info("Reclassified item tiers");

  // Step 7: Weekly VACUUM to reclaim freed pages from dropped columns/indexes/data
  const lastVacuum = db.prepare("SELECT value FROM system_meta WHERE key = 'last_vacuum'").get() as { value: string } | undefined;
  const daysSinceVacuum = lastVacuum
    ? (Date.now() - new Date(lastVacuum.value).getTime()) / 86400000
    : Infinity;

  if (daysSinceVacuum >= 7) {
    log.info("Running weekly VACUUM");
    db.exec("VACUUM");
    setMeta(db, "last_vacuum", new Date().toISOString());
    log.info("VACUUM complete");
  }

  // Step 8: Update system_meta
  setMeta(db, "last_maintenance", new Date().toISOString());

  const elapsed = Date.now() - start;
  log.info("Maintenance completed", { elapsedMs: elapsed });
}
