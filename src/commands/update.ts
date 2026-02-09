import { resolve, dirname } from "node:path";
import type Database from "better-sqlite3";
import { openDatabase, runMigrations } from "../db/database.js";
import { getMeta, setMeta } from "../db/queries.js";
import { TIER_CONFIGS, UNIVERSALIS_MAX_CONCURRENT, UPDATE_LONG_RUNNING_THRESHOLD_MS, DAEMON_DEFAULT_INTERVAL_MINUTES } from "../config/constants.js";
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
  daemon?: boolean;
  interval?: string;
  verbose?: boolean;
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

async function runSingleCycle(db: Database.Database, concurrency: number, cycleNumber: number): Promise<void> {
  const cycleStart = Date.now();

  // Check item_tiers is populated
  const tieredCount = db.prepare("SELECT COUNT(*) as count FROM item_tiers").get() as { count: number };
  if (tieredCount.count === 0) {
    log.warn("No items in item_tiers table — run 'tsx src/cli.ts sync-items' first");
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
    log.info("No tiers due for update, skipping", { cycle: cycleNumber });
    return;
  }

  log.info("Tiers due for update", {
    cycle: cycleNumber,
    tiers: dueTiers.map((t) => t.tier),
  });

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

  const elapsed = Date.now() - cycleStart;
  log.info("Cycle complete", { cycle: cycleNumber, totalProcessed, elapsedMs: elapsed });

  if (elapsed > UPDATE_LONG_RUNNING_THRESHOLD_MS) {
    log.warn("Cycle took longer than 4 minutes — may overlap with next interval", {
      cycle: cycleNumber,
      elapsedMs: elapsed,
      thresholdMs: UPDATE_LONG_RUNNING_THRESHOLD_MS,
    });
  }
}

export async function updateCommand(opts: UpdateOptions): Promise<void> {
  const dbPath = resolve(opts.db);
  const lockPath = resolve(dirname(dbPath), "marketboard.lock");

  const parsed = parseInt(opts.concurrency, 10) || UNIVERSALIS_MAX_CONCURRENT;
  const concurrency = Math.min(parsed, UNIVERSALIS_MAX_CONCURRENT);

  if (!opts.daemon) {
    // --- Single-run mode (existing behavior) ---
    if (!acquireLock(lockPath)) {
      log.info("Another update is running, skipping this cycle");
      return;
    }

    const cleanup = () => releaseLock(lockPath);
    process.on("SIGINT", () => { cleanup(); process.exit(130); });
    process.on("SIGTERM", () => { cleanup(); process.exit(143); });

    try {
      const db = openDatabase(dbPath);
      const migrationsDir = resolve(import.meta.dirname, "../../migrations");
      runMigrations(db, migrationsDir);

      await runSingleCycle(db, concurrency, 1);
      db.close();
    } finally {
      cleanup();
    }
    return;
  }

  // --- Daemon mode ---
  const intervalMinutes = Math.max(1, parseInt(opts.interval ?? String(DAEMON_DEFAULT_INTERVAL_MINUTES), 10) || DAEMON_DEFAULT_INTERVAL_MINUTES);
  const intervalMs = intervalMinutes * 60 * 1000;

  log.info("Starting daemon mode", { intervalMinutes });

  if (!acquireLock(lockPath)) {
    log.info("Another update is running, cannot start daemon");
    return;
  }

  const db = openDatabase(dbPath);
  const migrationsDir = resolve(import.meta.dirname, "../../migrations");
  runMigrations(db, migrationsDir);

  const controller = new AbortController();
  const { signal } = controller;

  const shutdown = () => {
    if (!signal.aborted) {
      log.info("Shutdown signal received, finishing current cycle…");
      controller.abort();
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  let cycleNumber = 0;
  try {
    while (!signal.aborted) {
      cycleNumber++;
      const cycleStart = Date.now();
      log.info("Daemon cycle start", { cycle: cycleNumber });

      try {
        await runSingleCycle(db, concurrency, cycleNumber);
      } catch (err) {
        log.error("Cycle failed (will retry next interval)", {
          cycle: cycleNumber,
          error: String(err),
        });
      }

      const cycleElapsed = Date.now() - cycleStart;
      const sleepMs = Math.max(0, intervalMs - cycleElapsed);

      if (!signal.aborted && sleepMs > 0) {
        log.info("Sleeping until next cycle", { sleepMs, cycle: cycleNumber });
        await abortableSleep(sleepMs, signal);
      }
    }
  } finally {
    db.close();
    releaseLock(lockPath);
    log.info("Daemon stopped", { totalCycles: cycleNumber });
  }
}
