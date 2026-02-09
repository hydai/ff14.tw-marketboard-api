import type Database from "better-sqlite3";
import { XIVAPIClient } from "../services/xivapi.js";
import { batchInsert } from "../db/batch.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("sync-items");

export async function processSyncItems(
  db: Database.Database,
  itemIds: number[],
  isNew: boolean,
): Promise<void> {
  const xivapi = new XIVAPIClient();
  const now = new Date().toISOString();

  log.info("Processing sync-items", {
    itemCount: itemIds.length,
    isNew,
  });

  const items = await xivapi.fetchItemsBatchV2(itemIds);
  const jaNames = await xivapi.fetchItemNamesBatchV2(itemIds, "ja");

  const rows = items.map((item) => [
    item.row_id,
    item.fields.Name || "",
    jaNames.get(item.row_id) || "",
    item.fields.Name || "",
    item.fields.Icon?.path || "",
    item.fields.ItemSearchCategory?.row_id ?? null,
    item.fields.ItemSearchCategory?.fields?.Name ?? null,
    item.fields.CanBeHq ? 1 : 0,
    item.fields.StackSize,
    now,
  ]);

  if (rows.length > 0) {
    batchInsert(
      db,
      "items",
      ["item_id", "name_en", "name_ja", "name_zh", "icon_path", "category_id", "category_name", "is_hq_available", "stack_size", "updated_at"],
      rows,
      "ON CONFLICT(item_id) DO UPDATE SET name_en=excluded.name_en, name_ja=excluded.name_ja, name_zh=excluded.name_zh, icon_path=excluded.icon_path, category_id=excluded.category_id, category_name=excluded.category_name, is_hq_available=excluded.is_hq_available, stack_size=excluded.stack_size, updated_at=excluded.updated_at"
    );

    const tierRows = items.map((item) => [item.row_id, 3, now]);
    batchInsert(
      db,
      "item_tiers",
      ["item_id", "tier", "updated_at"],
      tierRows,
      "ON CONFLICT(item_id) DO NOTHING"
    );

    log.info("Assigned default tiers", { count: tierRows.length });
  }

  log.info("Sync-items complete", {
    fetched: items.length,
    inserted: rows.length,
    isNew,
  });
}
