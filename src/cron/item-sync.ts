import { createLogger } from "../utils/logger";
import { UniversalisClient } from "../services/universalis";
import { XIVAPIClient } from "../services/xivapi";
import { KVCache } from "../cache/kv";
import { batchInsert } from "../db/batch";
import { setMeta } from "../db/queries";
import { DC_LUHANGNIAO } from "../config/datacenters";
import { KV_TTL_MARKETABLE_ITEMS } from "../config/constants";
import type { Env } from "../env";

const log = createLogger("item-sync");

export async function runItemSync(env: Env): Promise<void> {
  log.info("Starting daily item sync");
  const start = Date.now();

  const universalis = new UniversalisClient();
  const xivapi = new XIVAPIClient();
  const kv = new KVCache(env.KV);

  // Step 1: Fetch marketable item IDs
  const marketableIds = await universalis.fetchMarketableItems();
  log.info("Fetched marketable items", { count: marketableIds.length });

  // Store in KV
  await kv.putJSON(KVCache.marketableItemsKey(), marketableIds, KV_TTL_MARKETABLE_ITEMS);

  // Step 2: Check which items need insert/update in the DB
  const existingItems = await env.DB
    .prepare("SELECT item_id, updated_at FROM items")
    .all<{ item_id: number; updated_at: string }>();

  const existingMap = new Map<number, string>();
  for (const row of existingItems.results) {
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

  // Step 3: Fetch and insert new items
  const XIVAPI_BATCH = 50;
  if (newItemIds.length > 0) {
    for (let i = 0; i < newItemIds.length; i += XIVAPI_BATCH) {
      const batch = newItemIds.slice(i, i + XIVAPI_BATCH);
      const items = await xivapi.fetchItemsBatch(batch);

      const rows = items.map((item) => [
        item.row_id,
        item.fields.Name || "",
        item.fields["Name@ja"] || "",
        item.fields["Name@zh"] || item.fields.Name || "",
        item.fields.Icon?.path || "",
        item.fields.ItemSearchCategory?.row_id ?? null,
        item.fields.ItemSearchCategory?.fields?.Name ?? null,
        item.fields.CanBeHq ? 1 : 0,
        item.fields.StackSize,
        new Date().toISOString(),
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

      log.info("Inserted new items batch", { offset: i, fetched: items.length });
    }
  }

  // Step 4: Update stale items
  if (staleItemIds.length > 0) {
    for (let i = 0; i < staleItemIds.length; i += XIVAPI_BATCH) {
      const batch = staleItemIds.slice(i, i + XIVAPI_BATCH);
      const items = await xivapi.fetchItemsBatch(batch);

      const rows = items.map((item) => [
        item.row_id,
        item.fields.Name || "",
        item.fields["Name@ja"] || "",
        item.fields["Name@zh"] || item.fields.Name || "",
        item.fields.Icon?.path || "",
        item.fields.ItemSearchCategory?.row_id ?? null,
        item.fields.ItemSearchCategory?.fields?.Name ?? null,
        item.fields.CanBeHq ? 1 : 0,
        item.fields.StackSize,
        new Date().toISOString(),
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

      log.info("Updated stale items batch", { offset: i, fetched: items.length });
    }
  }

  // Step 5: Fetch and update tax rates for each world
  for (const world of DC_LUHANGNIAO.worlds) {
    try {
      const taxRates = await universalis.fetchTaxRates(world.id);
      const worldRates = taxRates[String(world.id)];
      if (!worldRates) continue;

      await env.DB
        .prepare(
          `INSERT INTO tax_rates (world_id, world_name, limsa, gridania, uldah, ishgard, kugane, crystarium, sharlayan, tuliyollal, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(world_id) DO UPDATE SET
             limsa=excluded.limsa, gridania=excluded.gridania, uldah=excluded.uldah,
             ishgard=excluded.ishgard, kugane=excluded.kugane, crystarium=excluded.crystarium,
             sharlayan=excluded.sharlayan, tuliyollal=excluded.tuliyollal, updated_at=excluded.updated_at`
        )
        .bind(
          world.id,
          world.name,
          worldRates["Limsa Lominsa"] ?? 0,
          worldRates["Gridania"] ?? 0,
          worldRates["Ul'dah"] ?? 0,
          worldRates["Ishgard"] ?? 0,
          worldRates["Kugane"] ?? 0,
          worldRates["Crystarium"] ?? 0,
          worldRates["Old Sharlayan"] ?? 0,
          worldRates["Tuliyollal"] ?? 0,
        )
        .run();

      log.info("Updated tax rates", { worldId: world.id, worldName: world.name });
    } catch (err) {
      log.error("Failed to fetch tax rates for world", {
        worldId: world.id,
        error: String(err),
      });
    }
  }

  // Step 6: Update item tiers based on sales velocity
  // Tier 1: >10 sales/day, Tier 2: 2-10 sales/day, Tier 3: <2 sales/day
  await env.DB
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

  // Also insert tier 3 for marketable items with no recent sales
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO item_tiers (item_id, tier, updated_at)
       SELECT item_id, 3, datetime('now')
       FROM items
       WHERE item_id NOT IN (SELECT item_id FROM item_tiers)`
    )
    .run();

  log.info("Updated item tiers");

  // Step 7: Update system_meta
  await setMeta(env.DB, "last_item_sync", new Date().toISOString());

  const elapsed = Date.now() - start;
  log.info("Item sync completed", { elapsedMs: elapsed });
}
