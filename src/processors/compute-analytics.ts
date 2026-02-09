import type Database from "better-sqlite3";
import {
  ARBITRAGE_MIN_PROFIT_GIL,
  ARBITRAGE_MIN_PROFIT_PCT,
  DEALS_MAX_PERCENTILE,
  VELOCITY_MIN_SALES_PER_DAY,
} from "../config/constants.js";
import { getArbitrageOpportunities, getDeals, getTrending } from "../db/queries.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("compute-analytics");

const ANALYTICS_RESULT_LIMIT = 50;

type AnalyticsKind = "arbitrage" | "deals" | "trending" | "velocity";

export function processComputeAnalytics(
  db: Database.Database,
  kind: AnalyticsKind,
): unknown {
  log.info("Computing analytics", { kind });

  switch (kind) {
    case "arbitrage":
      return computeArbitrage(db);
    case "deals":
      return computeDeals(db);
    case "trending":
      return computeTrending(db);
    case "velocity":
      return computeVelocity(db);
    default:
      log.error("Unknown analytics kind", { kind });
      return null;
  }
}

function computeArbitrage(db: Database.Database) {
  const result = getArbitrageOpportunities(db, {
    minProfit: ARBITRAGE_MIN_PROFIT_GIL,
    minProfitPct: ARBITRAGE_MIN_PROFIT_PCT,
    limit: ANALYTICS_RESULT_LIMIT,
  });
  log.info("Arbitrage computed", { count: result.length });
  return result;
}

function computeDeals(db: Database.Database) {
  const result = getDeals(db, {
    maxPercentile: DEALS_MAX_PERCENTILE,
    limit: ANALYTICS_RESULT_LIMIT,
  });
  log.info("Deals computed", { count: result.length });
  return result;
}

function computeTrending(db: Database.Database) {
  const up = getTrending(db, {
    direction: "up",
    period: "1d",
    limit: ANALYTICS_RESULT_LIMIT,
  });

  const down = getTrending(db, {
    direction: "down",
    period: "1d",
    limit: ANALYTICS_RESULT_LIMIT,
  });

  log.info("Trending computed", { upCount: up.length, downCount: down.length });
  return { up, down };
}

function computeVelocity(db: Database.Database) {
  const result = db.prepare(`
    SELECT
      sh.item_id,
      i.name_zh as item_name,
      COUNT(*) * 1.0 / 7 as sales_per_day,
      AVG(sh.price_per_unit) as avg_price,
      SUM(sh.total) * 1.0 / 7 as total_gil_per_day
    FROM sales_history sh
    JOIN items i ON i.item_id = sh.item_id
    WHERE sh.sold_at >= datetime('now', '-7 days')
    GROUP BY sh.item_id
    HAVING sales_per_day >= ?
    ORDER BY total_gil_per_day DESC
    LIMIT ?
  `).all(VELOCITY_MIN_SALES_PER_DAY, ANALYTICS_RESULT_LIMIT);

  log.info("Velocity computed", { count: result.length });
  return result;
}
