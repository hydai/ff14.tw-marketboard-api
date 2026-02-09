import { createLogger } from "../utils/logger";
import { UniversalisClient } from "../services/universalis";
import { KVCache } from "../cache/kv";
import { setMeta } from "../db/queries";
import { DC_LUHANGNIAO } from "../config/datacenters";
import { KV_TTL_MARKETABLE_ITEMS, QUEUE_BATCH_SIZE } from "../config/constants";
import { createSyncItemsMessage } from "../queue/messages";
import type { Env } from "../env";

const log = createLogger("item-sync");

export async function runItemSync(env: Env): Promise<void> {
  log.info("Starting daily item sync");
  const start = Date.now();

  const universalis = new UniversalisClient();
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

  // Step 3: Enqueue sync-items messages (instead of fetching inline)
  let messagesEnqueued = 0;

  for (let i = 0; i < newItemIds.length; i += QUEUE_BATCH_SIZE) {
    const batch = newItemIds.slice(i, i + QUEUE_BATCH_SIZE);
    await env.MARKET_QUEUE.send(createSyncItemsMessage(batch, true));
    messagesEnqueued++;
  }

  for (let i = 0; i < staleItemIds.length; i += QUEUE_BATCH_SIZE) {
    const batch = staleItemIds.slice(i, i + QUEUE_BATCH_SIZE);
    await env.MARKET_QUEUE.send(createSyncItemsMessage(batch, false));
    messagesEnqueued++;
  }

  log.info("Enqueued sync-items messages", {
    messages: messagesEnqueued,
    newItems: newItemIds.length,
    staleItems: staleItemIds.length,
  });

  // Step 4: Fetch and update tax rates for each world
  for (const world of DC_LUHANGNIAO.worlds) {
    try {
      const rates = await universalis.fetchTaxRates(world.id);

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
          rates["Limsa Lominsa"] ?? 0,
          rates["Gridania"] ?? 0,
          rates["Ul'dah"] ?? 0,
          rates["Ishgard"] ?? 0,
          rates["Kugane"] ?? 0,
          rates["Crystarium"] ?? 0,
          rates["Old Sharlayan"] ?? 0,
          rates["Tuliyollal"] ?? 0,
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

  // Step 5: Assign default tier for new items with no tier yet
  // Full tier reclassification runs daily in maintenance
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO item_tiers (item_id, tier, updated_at)
       SELECT item_id, 3, datetime('now')
       FROM items
       WHERE item_id NOT IN (SELECT item_id FROM item_tiers)`
    )
    .run();

  log.info("Updated item tiers");

  // Step 6: Update system_meta
  await setMeta(env.DB, "last_item_sync", new Date().toISOString());

  const elapsed = Date.now() - start;
  log.info("Item sync completed", { elapsedMs: elapsed });
}
