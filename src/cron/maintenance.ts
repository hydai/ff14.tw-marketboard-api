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
