import { resolve } from "node:path";
import { openDatabase, runMigrations } from "../db/database.js";
import { setMeta } from "../db/queries.js";
import { UniversalisClient } from "../services/universalis.js";
import { processSyncItems } from "../processors/sync-items.js";
import { DC_LUHANGNIAO } from "../config/datacenters.js";
import { QUEUE_BATCH_SIZE } from "../config/constants.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("sync-cmd");

interface SyncOptions {
  db: string;
  verbose?: boolean;
}

export async function syncCommand(opts: SyncOptions): Promise<void> {
  const dbPath = resolve(opts.db);
  const db = openDatabase(dbPath);
  const migrationsDir = resolve(import.meta.dirname, "../../migrations");
  runMigrations(db, migrationsDir);

  const start = Date.now();
  const universalis = new UniversalisClient();

  // Step 1: Fetch marketable item IDs
  const marketableIds = await universalis.fetchMarketableItems();
  log.info("Fetched marketable items", { count: marketableIds.length });

  // Step 2: Check which items need insert/update
  const existingItems = db
    .prepare("SELECT item_id, updated_at FROM items")
    .all() as { item_id: number; updated_at: string }[];

  const existingMap = new Map<number, string>();
  for (const row of existingItems) {
    existingMap.set(row.item_id, row.updated_at);
  }

  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const newItemIds: number[] = [];
  const staleItemIds: number[] = [];

  for (const id of marketableIds) {
    const existing = existingMap.get(id);
    if (!existing) {
      newItemIds.push(id);
    } else {
      const updatedAt = new Date(existing).getTime();
      if (now - updatedAt > sevenDaysMs) {
        staleItemIds.push(id);
      }
    }
  }

  log.info("Items to sync", { new: newItemIds.length, stale: staleItemIds.length });

  // Step 3: Process sync in batches
  for (let i = 0; i < newItemIds.length; i += QUEUE_BATCH_SIZE) {
    const batch = newItemIds.slice(i, i + QUEUE_BATCH_SIZE);
    await processSyncItems(db, batch, true);
  }

  for (let i = 0; i < staleItemIds.length; i += QUEUE_BATCH_SIZE) {
    const batch = staleItemIds.slice(i, i + QUEUE_BATCH_SIZE);
    await processSyncItems(db, batch, false);
  }

  // Step 4: Fetch and update tax rates for each world
  for (const world of DC_LUHANGNIAO.worlds) {
    try {
      const rates = await universalis.fetchTaxRates(world.id);

      db.prepare(
        `INSERT INTO tax_rates (world_id, world_name, limsa, gridania, uldah, ishgard, kugane, crystarium, sharlayan, tuliyollal, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(world_id) DO UPDATE SET
           limsa=excluded.limsa, gridania=excluded.gridania, uldah=excluded.uldah,
           ishgard=excluded.ishgard, kugane=excluded.kugane, crystarium=excluded.crystarium,
           sharlayan=excluded.sharlayan, tuliyollal=excluded.tuliyollal, updated_at=excluded.updated_at`
      ).run(
        world.id,
        world.name,
        rates["Limsa Lominsa"] ?? 0,
        rates["Gridania"] ?? 0,
        rates["Ul'dah"] ?? 0,
        rates["Ishgard"] ?? 0,
        rates["Kugane"] ?? 0,
        rates["Crystarium"] ?? 0,
        rates["Old Sharlayan"] ?? 0,
        rates["Tuliyollal"] ?? 0,
      );

      log.info("Updated tax rates", { worldId: world.id, worldName: world.name });
    } catch (err) {
      log.error("Failed to fetch tax rates for world", {
        worldId: world.id,
        error: String(err),
      });
    }
  }

  // Step 5: Assign default tier for new items with no tier yet
  db.prepare(
    `INSERT OR IGNORE INTO item_tiers (item_id, tier, updated_at)
     SELECT item_id, 3, datetime('now')
     FROM items
     WHERE item_id NOT IN (SELECT item_id FROM item_tiers)`
  ).run();

  log.info("Updated item tiers");

  // Step 6: Update system_meta
  setMeta(db, "last_item_sync", new Date().toISOString());

  db.close();
  const elapsed = Date.now() - start;
  log.info("Item sync completed", { elapsedMs: elapsed });
}
