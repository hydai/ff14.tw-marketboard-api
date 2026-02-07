import type { Env, SyncItemsMessage } from "../../env";
import { XIVAPIClient } from "../../services/xivapi";
import { batchInsert } from "../../db/batch";
import { createLogger } from "../../utils/logger";

const log = createLogger("sync-items");

export async function processSyncItems(
  msg: SyncItemsMessage,
  env: Env
): Promise<void> {
  const xivapi = new XIVAPIClient();
  const now = new Date().toISOString();

  log.info("Processing sync-items", {
    itemCount: msg.itemIds.length,
    isNew: msg.isNew,
  });

  // Fetch EN item data and JA names in 2 batch requests (instead of 2N individual ones)
  const items = await xivapi.fetchItemsBatchV2(msg.itemIds);
  const jaNames = await xivapi.fetchItemNamesBatchV2(msg.itemIds, "ja");

  const rows = items.map((item) => [
    item.row_id,
    item.fields.Name || "",
    jaNames.get(item.row_id) || "",
    item.fields.Name || "", // No Chinese in XIVAPI v2; fall back to English
    item.fields.Icon?.path || "",
    item.fields.ItemSearchCategory?.row_id ?? null,
    item.fields.ItemSearchCategory?.fields?.Name ?? null,
    item.fields.CanBeHq ? 1 : 0,
    item.fields.StackSize,
    now,
  ]);

  if (rows.length > 0) {
    await batchInsert(
      env.DB,
      "items",
      ["item_id", "name_en", "name_ja", "name_zh", "icon_path", "category_id", "category_name", "is_hq_available", "stack_size", "updated_at"],
      rows,
      "ON CONFLICT(item_id) DO UPDATE SET name_en=excluded.name_en, name_ja=excluded.name_ja, name_zh=excluded.name_zh, icon_path=excluded.icon_path, category_id=excluded.category_id, category_name=excluded.category_name, is_hq_available=excluded.is_hq_available, stack_size=excluded.stack_size, updated_at=excluded.updated_at"
    );
  }

  log.info("Sync-items complete", {
    fetched: items.length,
    inserted: rows.length,
    isNew: msg.isNew,
  });
}
