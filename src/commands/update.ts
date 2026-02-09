import { resolve, dirname } from "node:path";
import { openDatabase, runMigrations } from "../db/database.js";
import { getMeta, setMeta } from "../db/queries.js";
import { TIER_CONFIGS, UNIVERSALIS_MAX_CONCURRENT, UPDATE_LONG_RUNNING_THRESHOLD_MS } from "../config/constants.js";
import { UniversalisClient } from "../services/universalis.js";
import { processComputeAnalytics } from "../processors/compute-analytics.js";
import { fetchTierItems } from "../processors/tier-fetcher.js";
import { runAggregation } from "../cron/aggregation.js";
import { runMaintenance } from "../cron/maintenance.js";
import { RateLimiter } from "../utils/rate-limiter.js";
import { acquireLock, releaseLock } from "../utils/lock.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("update-cmd");

const MAINTENANCE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ITEM_SYNC_WARN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

interface UpdateOptions {
  db: string;
  concurrency: string;
  verbose?: boolean;
}

export async function updateCommand(opts: UpdateOptions): Promise<void> {
  const startTime = Date.now();
  const dbPath = resolve(opts.db);
  const lockPath = resolve(dirname(dbPath), "marketboard.lock");

  // Acquire lock — exit cleanly if another update is running
  if (!acquireLock(lockPath)) {
    log.info("Another update is running, skipping this cycle");
    return;
  }

  // Ensure lock is released on exit
  const cleanup = () => releaseLock(lockPath);
  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { cleanup(); process.exit(143); });

  try {
    const db = openDatabase(dbPath);
    const migrationsDir = resolve(import.meta.dirname, "../../migrations");
    runMigrations(db, migrationsDir);

    // Check item_tiers is populated
    const tieredCount = db.prepare("SELECT COUNT(*) as count FROM item_tiers").get() as { count: number };
    if (tieredCount.count === 0) {
      log.warn("No items in item_tiers table — run 'tsx src/cli.ts sync-items' first");
      db.close();
      return;
    }

    // Determine which tiers are due
    const now = Date.now();
    const dueTiers = TIER_CONFIGS.filter((tc) => {
      const metaKey = `last_fetch_tier_${tc.tier}`;
      const lastFetch = getMeta(db, metaKey);
      if (!lastFetch) return true; // never fetched → due
      const elapsed = now - new Date(lastFetch.value).getTime();
      return elapsed >= tc.frequencyMinutes * 60 * 1000;
    });

    if (dueTiers.length === 0) {
      log.info("No tiers due for update, skipping");
      db.close();
      return;
    }

    log.info("Tiers due for update", {
      tiers: dueTiers.map((t) => t.tier),
    });

    // Parse concurrency
    const parsed = parseInt(opts.concurrency, 10) || UNIVERSALIS_MAX_CONCURRENT;
    const concurrency = Math.min(parsed, UNIVERSALIS_MAX_CONCURRENT);
    const limiter = new RateLimiter(concurrency);

    // Fetch marketable items once
    const universalis = new UniversalisClient();
    const marketableItems = await universalis.fetchMarketableItems();
    const marketableSet = new Set(marketableItems);
    log.info("Marketable items fetched", { count: marketableItems.length });

    // Fetch due tiers
    let totalProcessed = 0;
    for (const tierConfig of dueTiers) {
      const count = await fetchTierItems(db, tierConfig, marketableSet, limiter);
      totalProcessed += count;
      setMeta(db, `last_fetch_tier_${tierConfig.tier}`, new Date().toISOString());
    }

    // Post-fetch: aggregation + analytics
    if (totalProcessed > 0) {
      log.info("Running post-fetch aggregation");
      runAggregation(db);

      const kinds = ["arbitrage", "deals", "trending", "velocity"] as const;
      for (const kind of kinds) {
        processComputeAnalytics(db, kind);
      }
    }

    setMeta(db, "last_poll_time", new Date().toISOString());

    // Maintenance check (daily)
    const lastMaintenance = getMeta(db, "last_maintenance");
    if (!lastMaintenance || now - new Date(lastMaintenance.value).getTime() >= MAINTENANCE_INTERVAL_MS) {
      log.info("Running daily maintenance");
      runMaintenance(db);
    }

    // Item sync staleness warning (weekly)
    const lastItemSync = getMeta(db, "last_item_sync");
    if (!lastItemSync || now - new Date(lastItemSync.value).getTime() >= ITEM_SYNC_WARN_INTERVAL_MS) {
      log.warn("Item metadata may be stale — consider running 'tsx src/cli.ts sync-items'");
    }

    db.close();

    const elapsed = Date.now() - startTime;
    log.info("Update complete", { totalProcessed, elapsedMs: elapsed });

    if (elapsed > UPDATE_LONG_RUNNING_THRESHOLD_MS) {
      log.warn("Update took longer than 4 minutes — may overlap with next cron cycle", {
        elapsedMs: elapsed,
        thresholdMs: UPDATE_LONG_RUNNING_THRESHOLD_MS,
      });
    }
  } finally {
    cleanup();
  }
}
