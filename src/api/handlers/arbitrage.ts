import { Context } from "hono";
import type Database from "better-sqlite3";
import {
  ARBITRAGE_MIN_PROFIT_GIL,
  ARBITRAGE_MIN_PROFIT_PCT,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
} from "../../config/constants.js";
import { getArbitrageOpportunities } from "../../db/queries.js";

type AppEnv = { Variables: { db: Database.Database } };

export function getArbitrage(c: Context<AppEnv>) {
  const db = c.get("db");
  const minProfit = Number(c.req.query("minProfit")) || ARBITRAGE_MIN_PROFIT_GIL;
  const minProfitPct = Number(c.req.query("minProfitPct")) || ARBITRAGE_MIN_PROFIT_PCT;
  const category = c.req.query("category") ? Number(c.req.query("category")) : undefined;
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query("limit")) || DEFAULT_PAGE_SIZE));

  const data = getArbitrageOpportunities(db, {
    minProfit,
    minProfitPct,
    category,
    limit,
  });

  return c.json({ data });
}
