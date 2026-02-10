import type Database from "better-sqlite3";
import { isoTimeAgo } from "../utils/datetime.js";

// ── Items ──────────────────────────────────────────

export function getItemById(db: Database.Database, itemId: number) {
  return db.prepare("SELECT * FROM items WHERE item_id = ?").get(itemId);
}

export function searchItems(
  db: Database.Database,
  opts: { search?: string; category?: number; page: number; limit: number }
) {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.search) {
    conditions.push("(name_en LIKE ? OR name_zh LIKE ?)");
    const term = `%${opts.search}%`;
    params.push(term, term);
  }
  if (opts.category) {
    conditions.push("category_id = ?");
    params.push(opts.category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (opts.page - 1) * opts.limit;

  const countSql = `SELECT COUNT(*) as total FROM items ${where}`;
  const dataSql = `SELECT * FROM items ${where} ORDER BY item_id LIMIT ? OFFSET ?`;

  const countRow = db.prepare(countSql).get(...params) as { total: number } | undefined;
  const data = db.prepare(dataSql).all(...params, opts.limit, offset);

  return {
    total: countRow?.total ?? 0,
    data,
  };
}

// ── Listings ───────────────────────────────────────

export function getListingsByItem(db: Database.Database, itemId: number, hq?: boolean) {
  let sql = "SELECT * FROM current_listings WHERE item_id = ?";
  const params: unknown[] = [itemId];
  if (hq !== undefined) {
    sql += " AND hq = ?";
    params.push(hq ? 1 : 0);
  }
  sql += " ORDER BY price_per_unit ASC";
  return db.prepare(sql).all(...params);
}

export function getListingsByItemAndWorld(
  db: Database.Database,
  itemId: number,
  worldId: number,
  hq?: boolean
) {
  let sql = "SELECT * FROM current_listings WHERE item_id = ? AND world_id = ?";
  const params: unknown[] = [itemId, worldId];
  if (hq !== undefined) {
    sql += " AND hq = ?";
    params.push(hq ? 1 : 0);
  }
  sql += " ORDER BY price_per_unit ASC";
  return db.prepare(sql).all(...params);
}

export function deleteListingsForItem(db: Database.Database, itemId: number) {
  return db.prepare("DELETE FROM current_listings WHERE item_id = ?").run(itemId);
}

// ── Price Snapshots ────────────────────────────────

export function getLatestSnapshot(db: Database.Database, itemId: number) {
  return db
    .prepare(
      "SELECT * FROM price_snapshots WHERE item_id = ? ORDER BY snapshot_time DESC LIMIT 1"
    )
    .get(itemId);
}

export function getPriceHistory(
  db: Database.Database,
  itemId: number,
  opts: { since: string; resolution: "raw" | "hourly" | "daily" }
) {
  const table =
    opts.resolution === "hourly"
      ? "hourly_aggregates"
      : opts.resolution === "daily"
        ? "daily_aggregates"
        : "price_snapshots";

  const timeCol =
    opts.resolution === "hourly"
      ? "hour_timestamp"
      : opts.resolution === "daily"
        ? "day_timestamp"
        : "snapshot_time";

  const sql = `SELECT * FROM ${table} WHERE item_id = ? AND ${timeCol} >= ? ORDER BY ${timeCol} ASC`;
  return db.prepare(sql).all(itemId, opts.since);
}

// ── Sales History ──────────────────────────────────

export function getRecentSales(
  db: Database.Database,
  itemId: number,
  opts: { days: number; worldId?: number }
) {
  const since = new Date(Date.now() - opts.days * 86400000).toISOString();
  let sql = "SELECT * FROM sales_history WHERE item_id = ? AND sold_at >= ?";
  const params: unknown[] = [itemId, since];

  if (opts.worldId) {
    sql += " AND world_id = ?";
    params.push(opts.worldId);
  }

  sql += " ORDER BY sold_at DESC LIMIT 200";
  return db.prepare(sql).all(...params);
}

// ── Tax Rates ──────────────────────────────────────

export function getTaxRates(db: Database.Database) {
  return db.prepare("SELECT * FROM tax_rates ORDER BY world_id").all();
}

// ── System Meta ────────────────────────────────────

export function getMeta(db: Database.Database, key: string) {
  return db.prepare("SELECT value FROM system_meta WHERE key = ?").get(key) as { value: string } | undefined;
}

export function setMeta(db: Database.Database, key: string, value: string) {
  return db
    .prepare(
      "INSERT INTO system_meta (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    )
    .run(key, value);
}

// ── Item Tiers ─────────────────────────────────────

export function getItemsByTier(db: Database.Database, tier: number) {
  return db.prepare("SELECT item_id FROM item_tiers WHERE tier = ?").all(tier) as { item_id: number }[];
}

// ── Arbitrage ──────────────────────────────────────

export function getArbitrageOpportunities(
  db: Database.Database,
  opts: { minProfit: number; minProfitPct: number; category?: number; limit: number }
) {
  let sql = `
    WITH world_mins AS (
      SELECT item_id, world_id, world_name, MIN(price_per_unit) as min_price_nq
      FROM current_listings
      WHERE hq = 0
      GROUP BY item_id, world_id
    ),
    buy_sell AS (
      SELECT
        b.item_id,
        b.world_name as buy_world,
        b.min_price_nq as buy_price,
        s.world_name as sell_world,
        s.min_price_nq as sell_price,
        (s.min_price_nq - b.min_price_nq) as profit,
        CAST((s.min_price_nq - b.min_price_nq) AS REAL) / b.min_price_nq * 100 as profit_pct
      FROM world_mins b
      CROSS JOIN world_mins s
      WHERE b.item_id = s.item_id
        AND b.world_id != s.world_id
        AND b.min_price_nq > 0
        AND s.min_price_nq > b.min_price_nq
    )
    SELECT bs.*, i.name_zh as item_name
    FROM buy_sell bs
    JOIN items i ON i.item_id = bs.item_id
    WHERE bs.profit >= ? AND bs.profit_pct >= ?`;

  const params: unknown[] = [opts.minProfit, opts.minProfitPct];

  if (opts.category) {
    sql += " AND i.category_id = ?";
    params.push(opts.category);
  }

  sql += " ORDER BY bs.profit_pct DESC LIMIT ?";
  params.push(opts.limit);

  return db.prepare(sql).all(...params);
}

// ── Deals ──────────────────────────────────────────

export function getDeals(
  db: Database.Database,
  opts: { maxPercentile: number; category?: number; worldId?: number; limit: number }
) {
  let sql = `
    WITH world_mins AS (
      SELECT item_id, world_id, world_name,
             MIN(price_per_unit) as min_price
      FROM current_listings
      WHERE hq = 0
      GROUP BY item_id, world_id
    ),
    max_min AS (
      SELECT item_id,
             MAX(min_price) as max_min_price
      FROM world_mins
      GROUP BY item_id
    ),
    cheapest AS (
      SELECT wm.item_id, wm.world_id, wm.world_name, wm.min_price as price_per_unit,
             ROW_NUMBER() OVER (PARTITION BY wm.item_id ORDER BY wm.min_price ASC) as rn
      FROM world_mins wm`;

  const params: unknown[] = [];

  if (opts.worldId) {
    sql += " WHERE wm.world_id = ?";
    params.push(opts.worldId);
  }

  sql += `
    )
    SELECT c.item_id, i.name_zh as item_name, c.world_name, c.price_per_unit as current_price,
           mm.max_min_price as average_price,
           ROUND((1 - CAST(c.price_per_unit AS REAL) / mm.max_min_price) * 100, 1) as discount
    FROM cheapest c
    JOIN max_min mm ON mm.item_id = c.item_id
    JOIN items i ON i.item_id = c.item_id
    WHERE c.rn = 1
      AND c.price_per_unit < mm.max_min_price * (? / 100.0)`;

  params.push(opts.maxPercentile);

  if (opts.category) {
    sql += " AND i.category_id = ?";
    params.push(opts.category);
  }

  sql += " ORDER BY discount DESC LIMIT ?";
  params.push(opts.limit);

  return db.prepare(sql).all(...params);
}

// ── Velocity ──────────────────────────────────

export function getVelocity(
  db: Database.Database,
  opts: { days: number; minSales: number; category?: number; limit: number }
) {
  const soldAtCutoff = isoTimeAgo(opts.days * 24);

  let sql = `
    WITH daily_sales AS (
      SELECT item_id,
             COUNT(*) as total_sales,
             SUM(price_per_unit * quantity) as total_gil,
             AVG(price_per_unit) as avg_price
      FROM sales_history
      WHERE sold_at >= ?
      GROUP BY item_id
    )
    SELECT ds.item_id, i.name_zh as item_name,
           ROUND(CAST(ds.total_sales AS REAL) / ${opts.days}, 1) as sales_per_day,
           ROUND(ds.avg_price) as avg_price,
           ROUND(CAST(ds.total_gil AS REAL) / ${opts.days}) as total_gil_per_day
    FROM daily_sales ds
    JOIN items i ON i.item_id = ds.item_id
    WHERE CAST(ds.total_sales AS REAL) / ${opts.days} >= ?`;

  const params: unknown[] = [soldAtCutoff, opts.minSales];

  if (opts.category) {
    sql += " AND i.category_id = ?";
    params.push(opts.category);
  }

  sql += " ORDER BY sales_per_day DESC LIMIT ?";
  params.push(opts.limit);

  return db.prepare(sql).all(...params);
}

// ── Trending ───────────────────────────────────────

export function getTrendingDiagnostics(
  db: Database.Database,
  opts: { period: string }
) {
  const periodHours = opts.period === "1d" ? 24 : opts.period === "7d" ? 168 : 72;
  const midpointISO = isoTimeAgo(Math.floor(periodHours / 2));
  const periodStartISO = isoTimeAgo(periodHours);

  const recentItems = db.prepare(
    "SELECT COUNT(DISTINCT item_id) as cnt FROM price_snapshots WHERE snapshot_time >= ? AND avg_price_nq > 0"
  ).get(midpointISO) as { cnt: number };

  const olderItems = db.prepare(
    "SELECT COUNT(DISTINCT item_id) as cnt FROM price_snapshots WHERE snapshot_time < ? AND snapshot_time >= ? AND avg_price_nq > 0"
  ).get(midpointISO, periodStartISO) as { cnt: number };

  const newest = db.prepare(
    "SELECT MAX(snapshot_time) as val FROM price_snapshots"
  ).get() as { val: string | null };

  return {
    recentItems: recentItems.cnt,
    olderItems: olderItems.cnt,
    periodStart: periodStartISO,
    midpoint: midpointISO,
    newestSnapshot: newest.val,
  };
}

export function getTrending(
  db: Database.Database,
  opts: { direction: "up" | "down"; period: string; category?: number; limit: number }
) {
  const periodHours = opts.period === "1d" ? 24 : opts.period === "7d" ? 168 : 72;
  const midpointISO = isoTimeAgo(Math.floor(periodHours / 2));
  const periodStartISO = isoTimeAgo(periodHours);

  let sql = `
    WITH recent AS (
      SELECT item_id, AVG(avg_price_nq) as avg_price
      FROM price_snapshots
      WHERE snapshot_time >= ? AND avg_price_nq > 0
      GROUP BY item_id
    ),
    older AS (
      SELECT item_id, AVG(avg_price_nq) as avg_price
      FROM price_snapshots
      WHERE snapshot_time < ?
        AND snapshot_time >= ?
        AND avg_price_nq > 0
      GROUP BY item_id
    )
    SELECT r.item_id, i.name_zh as item_name,
           r.avg_price as current_price, o.avg_price as previous_price,
           ROUND((r.avg_price - o.avg_price) / o.avg_price * 100, 1) as change_pct
    FROM recent r
    JOIN older o ON o.item_id = r.item_id
    JOIN items i ON i.item_id = r.item_id
    WHERE o.avg_price > 0`;

  const params: unknown[] = [midpointISO, midpointISO, periodStartISO];

  if (opts.direction === "up") {
    sql += " AND r.avg_price > o.avg_price AND (r.avg_price - o.avg_price) / o.avg_price > 0.1";
  } else {
    sql += " AND r.avg_price < o.avg_price AND (o.avg_price - r.avg_price) / o.avg_price > 0.1";
  }

  if (opts.category) {
    sql += " AND i.category_id = ?";
    params.push(opts.category);
  }

  sql += " ORDER BY ABS(change_pct) DESC LIMIT ?";
  params.push(opts.limit);

  return db.prepare(sql).all(...params);
}
