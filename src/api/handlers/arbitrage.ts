import { Context } from "hono";
import type { Env } from "../../env";
import {
  ARBITRAGE_MIN_PROFIT_GIL,
  ARBITRAGE_MIN_PROFIT_PCT,
  DEFAULT_PAGE_SIZE,
  KV_TTL_ANALYTICS,
  MAX_PAGE_SIZE,
} from "../../config/constants";
import { KVCache } from "../../cache/kv";
import { getArbitrageOpportunities } from "../../db/queries";

export async function getArbitrage(c: Context<{ Bindings: Env }>) {
  const minProfit = Number(c.req.query("minProfit")) || ARBITRAGE_MIN_PROFIT_GIL;
  const minProfitPct = Number(c.req.query("minProfitPct")) || ARBITRAGE_MIN_PROFIT_PCT;
  const category = c.req.query("category") ? Number(c.req.query("category")) : undefined;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query("limit")) || DEFAULT_PAGE_SIZE));

  // KV cache first (only for default params with no category filter)
  const kv = new KVCache(c.env.KV);
  if (!category && minProfit === ARBITRAGE_MIN_PROFIT_GIL && minProfitPct === ARBITRAGE_MIN_PROFIT_PCT) {
    const cached = await kv.getJSON(KVCache.arbitrageKey());
    if (cached) {
      return c.json({ data: cached });
    }
  }

  const result = await getArbitrageOpportunities(c.env.DB, {
    minProfit,
    minProfitPct,
    category,
    limit,
  });

  // Cache default results
  if (!category && minProfit === ARBITRAGE_MIN_PROFIT_GIL && minProfitPct === ARBITRAGE_MIN_PROFIT_PCT) {
    await kv.putJSON(KVCache.arbitrageKey(), result.results, KV_TTL_ANALYTICS);
  }

  return c.json({ data: result.results });
}
