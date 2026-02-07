import type { Env } from "../env";
import { QUEUE_BATCH_SIZE, TIER_CONFIGS, KV_TTL_MARKETABLE_ITEMS } from "../config/constants";
import { UniversalisClient } from "../services/universalis";
import { KVCache } from "../cache/kv";
import { getItemsByTier, setMeta } from "../db/queries";
import { createFetchPricesMessage, createFetchAggregatedMessage, createComputeAnalyticsMessage } from "../queue/messages";
import { createLogger } from "../utils/logger";
import { chunk } from "../utils/math";

const log = createLogger("cron-dispatcher");

export async function dispatch(env: Env): Promise<void> {
  const cache = new KVCache(env.KV);
  const client = new UniversalisClient();

  // Ensure marketable items are cached
  let marketableItems = await cache.getJSON<number[]>(KVCache.marketableItemsKey());
  if (!marketableItems) {
    log.info("Fetching marketable items from Universalis");
    marketableItems = await client.fetchMarketableItems();
    await cache.putJSON(KVCache.marketableItemsKey(), marketableItems, KV_TTL_MARKETABLE_ITEMS);
    log.info("Cached marketable items", { count: marketableItems.length });
  }

  const marketableSet = new Set(marketableItems);

  // Determine which tiers to poll this cycle based on current minute
  const now = new Date();
  const minutesSinceMidnight = now.getUTCHours() * 60 + now.getUTCMinutes();

  let totalEnqueued = 0;
  let fetchPricesEnqueued = 0;
  let fetchAggregatedEnqueued = 0;

  for (const tierConfig of TIER_CONFIGS) {
    // Check if this tier should fire this cycle
    if (minutesSinceMidnight % tierConfig.frequencyMinutes !== 0) {
      continue;
    }

    // Read items assigned to this tier from D1
    const tierResult = await getItemsByTier(env.DB, tierConfig.tier);
    const tierItems = (tierResult.results ?? [])
      .map((r) => r.item_id)
      .filter((id) => marketableSet.has(id));

    if (tierItems.length === 0) {
      log.info("No items for tier", { tier: tierConfig.tier });
      continue;
    }

    log.info("Dispatching tier", {
      tier: tierConfig.tier,
      itemCount: tierItems.length,
      useAggregated: tierConfig.useAggregated,
    });

    // Chunk items into batches of QUEUE_BATCH_SIZE and enqueue
    const batches = chunk(tierItems, QUEUE_BATCH_SIZE);
    for (const batch of batches) {
      if (tierConfig.useAggregated) {
        await env.MARKET_QUEUE.send(createFetchAggregatedMessage(batch));
        fetchAggregatedEnqueued++;
      } else {
        await env.MARKET_QUEUE.send(
          createFetchPricesMessage(batch, tierConfig.tier as 1 | 2 | 3)
        );
        fetchPricesEnqueued++;
      }
      totalEnqueued++;
    }
  }

  // After price fetch messages, enqueue analytics computations
  if (totalEnqueued > 0) {
    const analyticsKinds = ["arbitrage", "deals", "trending", "velocity"] as const;
    for (const kind of analyticsKinds) {
      await env.MARKET_QUEUE.send(createComputeAnalyticsMessage(kind));
    }
    log.info("Enqueued analytics computations", { kinds: analyticsKinds.length });
  }

  await setMeta(env.DB, "last_poll_time", new Date().toISOString());
  await setMeta(env.DB, "last_dispatch_fetch_prices", String(fetchPricesEnqueued));
  await setMeta(env.DB, "last_dispatch_fetch_aggregated", String(fetchAggregatedEnqueued));

  log.info("Dispatch complete", { totalEnqueued, fetchPricesEnqueued, fetchAggregatedEnqueued });
}
