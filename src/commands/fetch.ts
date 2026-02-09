import { resolve } from "node:path";
import { openDatabase, runMigrations } from "../db/database.js";
import { getItemsByTier, setMeta } from "../db/queries.js";
import { TIER_CONFIGS, UNIVERSALIS_ITEMS_PER_REQUEST, UNIVERSALIS_MAX_CONCURRENT, QUEUE_BATCH_SIZE } from "../config/constants.js";
import { UniversalisClient } from "../services/universalis.js";
import { processFetchPrices } from "../processors/fetch-prices.js";
import { processFetchAggregated } from "../processors/fetch-aggregated.js";
import { processComputeAnalytics } from "../processors/compute-analytics.js";
import { runAggregation } from "../cron/aggregation.js";
import { RateLimiter } from "../utils/rate-limiter.js";
import { chunk } from "../utils/math.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("fetch-cmd");

interface FetchOptions {
  db: string;
  tier?: string;
  concurrency: string;
  verbose?: boolean;
}

export async function fetchCommand(opts: FetchOptions): Promise<void> {
  const dbPath = resolve(opts.db);
  const db = openDatabase(dbPath);
  const migrationsDir = resolve(import.meta.dirname, "../../migrations");
  runMigrations(db, migrationsDir);

  const parsed = parseInt(opts.concurrency, 10) || UNIVERSALIS_MAX_CONCURRENT;
  const concurrency = Math.min(parsed, UNIVERSALIS_MAX_CONCURRENT);
  if (parsed > UNIVERSALIS_MAX_CONCURRENT) {
    log.warn("Concurrency capped at UNIVERSALIS_MAX_CONCURRENT", {
      requested: parsed,
      capped: UNIVERSALIS_MAX_CONCURRENT,
    });
  }
  const limiter = new RateLimiter(concurrency);
  const tierFilter = opts.tier ? parseInt(opts.tier, 10) : undefined;

  // Fetch marketable items
  const universalis = new UniversalisClient();
  const marketableItems = await universalis.fetchMarketableItems();
  const marketableSet = new Set(marketableItems);

  log.info("Marketable items fetched", { count: marketableItems.length });

  let totalProcessed = 0;

  for (const tierConfig of TIER_CONFIGS) {
    if (tierFilter && tierConfig.tier !== tierFilter) continue;

    const tierItems = getItemsByTier(db, tierConfig.tier)
      .map((r) => r.item_id)
      .filter((id) => marketableSet.has(id));

    if (tierItems.length === 0) {
      log.info("No items for tier", { tier: tierConfig.tier });
      continue;
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
    totalProcessed += tierItems.length;
  }

  // Run aggregation after all fetches
  if (totalProcessed > 0) {
    log.info("Running post-fetch aggregation");
    runAggregation(db);

    // Compute analytics
    const kinds = ["arbitrage", "deals", "trending", "velocity"] as const;
    for (const kind of kinds) {
      processComputeAnalytics(db, kind);
    }
  }

  setMeta(db, "last_poll_time", new Date().toISOString());

  db.close();
  log.info("Fetch complete", { totalProcessed });
}
