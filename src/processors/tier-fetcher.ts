import type Database from "better-sqlite3";
import type { TierConfig } from "../config/constants.js";
import { UNIVERSALIS_ITEMS_PER_REQUEST, QUEUE_BATCH_SIZE } from "../config/constants.js";
import { getItemsByTier } from "../db/queries.js";
import { processFetchPrices } from "./fetch-prices.js";
import { processFetchAggregated } from "./fetch-aggregated.js";
import { RateLimiter } from "../utils/rate-limiter.js";
import { chunk } from "../utils/math.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("tier-fetcher");

export async function fetchTierItems(
  db: Database.Database,
  tierConfig: TierConfig,
  marketableSet: Set<number>,
  limiter: RateLimiter,
): Promise<number> {
  const tierItems = getItemsByTier(db, tierConfig.tier)
    .map((r) => r.item_id)
    .filter((id) => marketableSet.has(id));

  if (tierItems.length === 0) {
    log.info("No items for tier", { tier: tierConfig.tier });
    return 0;
  }

  log.info("Processing tier", {
    tier: tierConfig.tier,
    itemCount: tierItems.length,
    useAggregated: tierConfig.useAggregated,
  });

  const batchSize = tierConfig.useAggregated
    ? QUEUE_BATCH_SIZE
    : UNIVERSALIS_ITEMS_PER_REQUEST;
  const batches = chunk(tierItems, batchSize);

  const tasks = batches.map((batch) => async () => {
    if (tierConfig.useAggregated) {
      await processFetchAggregated(db, batch);
    } else {
      await processFetchPrices(db, batch, tierConfig.tier as 1 | 2 | 3);
    }
  });

  await limiter.runAll(tasks);
  return tierItems.length;
}
