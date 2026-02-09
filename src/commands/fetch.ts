import { resolve } from "node:path";
import { openDatabase, runMigrations } from "../db/database.js";
import { setMeta } from "../db/queries.js";
import { TIER_CONFIGS, UNIVERSALIS_MAX_CONCURRENT } from "../config/constants.js";
import { UniversalisClient } from "../services/universalis.js";
import { processComputeAnalytics } from "../processors/compute-analytics.js";
import { fetchTierItems } from "../processors/tier-fetcher.js";
import { runAggregation } from "../cron/aggregation.js";
import { RateLimiter } from "../utils/rate-limiter.js";
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

  const tieredCount = db.prepare("SELECT COUNT(*) as count FROM item_tiers").get() as { count: number };
  if (tieredCount.count === 0) {
    log.warn("No items in item_tiers table — run 'tsx src/cli.ts sync-items' first to populate item tiers");
    db.close();
    return;
  }

  let totalProcessed = 0;

  for (const tierConfig of TIER_CONFIGS) {
    if (tierFilter && tierConfig.tier !== tierFilter) continue;
    totalProcessed += await fetchTierItems(db, tierConfig, marketableSet, limiter);
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
