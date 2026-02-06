import type { Env, ComputeAnalyticsMessage } from "../../env";
import {
  KV_TTL_ANALYTICS,
  ARBITRAGE_MIN_PROFIT_GIL,
  ARBITRAGE_MIN_PROFIT_PCT,
  DEALS_MAX_PERCENTILE,
  VELOCITY_MIN_SALES_PER_DAY,
} from "../../config/constants";
import { KVCache } from "../../cache/kv";
import { getArbitrageOpportunities, getDeals, getTrending } from "../../db/queries";
import { createLogger } from "../../utils/logger";

const log = createLogger("compute-analytics");

const ANALYTICS_RESULT_LIMIT = 50;

export async function processComputeAnalytics(
  msg: ComputeAnalyticsMessage,
  env: Env
): Promise<void> {
  const cache = new KVCache(env.KV);

  log.info("Computing analytics", { kind: msg.kind });

  switch (msg.kind) {
    case "arbitrage":
      await computeArbitrage(env, cache);
      break;
    case "deals":
      await computeDeals(env, cache);
      break;
    case "trending":
      await computeTrending(env, cache);
      break;
    case "velocity":
      await computeVelocity(env, cache);
      break;
    default:
      log.error("Unknown analytics kind", { kind: msg.kind });
  }
}

async function computeArbitrage(env: Env, cache: KVCache): Promise<void> {
  const result = await getArbitrageOpportunities(env.DB, {
    minProfit: ARBITRAGE_MIN_PROFIT_GIL,
    minProfitPct: ARBITRAGE_MIN_PROFIT_PCT,
    limit: ANALYTICS_RESULT_LIMIT,
  });

  await cache.putJSON(KVCache.arbitrageKey(), result.results, KV_TTL_ANALYTICS);
  log.info("Arbitrage computed", { count: result.results?.length ?? 0 });
}

async function computeDeals(env: Env, cache: KVCache): Promise<void> {
  const result = await getDeals(env.DB, {
    maxPercentile: DEALS_MAX_PERCENTILE,
    limit: ANALYTICS_RESULT_LIMIT,
  });

  await cache.putJSON(KVCache.dealsKey(), result.results, KV_TTL_ANALYTICS);
  log.info("Deals computed", { count: result.results?.length ?? 0 });
}

async function computeTrending(env: Env, cache: KVCache): Promise<void> {
  const upResult = await getTrending(env.DB, {
    direction: "up",
    period: "1d",
    limit: ANALYTICS_RESULT_LIMIT,
  });

  const downResult = await getTrending(env.DB, {
    direction: "down",
    period: "1d",
    limit: ANALYTICS_RESULT_LIMIT,
  });

  await cache.putJSON("trending:up", upResult.results, KV_TTL_ANALYTICS);
  await cache.putJSON("trending:down", downResult.results, KV_TTL_ANALYTICS);
  log.info("Trending computed", {
    upCount: upResult.results?.length ?? 0,
    downCount: downResult.results?.length ?? 0,
  });
}

async function computeVelocity(env: Env, cache: KVCache): Promise<void> {
  // Compute high-velocity items from recent sales data
  const result = await env.DB.prepare(`
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
  `).bind(VELOCITY_MIN_SALES_PER_DAY, ANALYTICS_RESULT_LIMIT).all();

  await cache.putJSON("velocity:top", result.results, KV_TTL_ANALYTICS);
  log.info("Velocity computed", { count: result.results?.length ?? 0 });
}
