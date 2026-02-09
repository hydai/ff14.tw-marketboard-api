import { Context } from "hono";
import type Database from "better-sqlite3";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  VELOCITY_MIN_SALES_PER_DAY,
} from "../../config/constants.js";
import { isoTimeAgo } from "../../utils/datetime.js";

type AppEnv = { Variables: { db: Database.Database } };

export function listVelocity(c: Context<AppEnv>) {
  const db = c.get("db");
  const category = c.req.query("category") ? Number(c.req.query("category")) : undefined;
  const minSales = Number(c.req.query("minSales")) || VELOCITY_MIN_SALES_PER_DAY;
  const days = Math.min(30, Math.max(1, Number(c.req.query("days")) || 7));
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query("limit")) || DEFAULT_PAGE_SIZE));

  const soldAtCutoff = isoTimeAgo(days * 24);

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
           ROUND(CAST(ds.total_sales AS REAL) / ${days}, 1) as sales_per_day,
           ROUND(ds.avg_price) as avg_price,
           ROUND(CAST(ds.total_gil AS REAL) / ${days}) as total_gil_per_day
    FROM daily_sales ds
    JOIN items i ON i.item_id = ds.item_id
    WHERE CAST(ds.total_sales AS REAL) / ${days} >= ?`;

  const params: unknown[] = [soldAtCutoff, minSales];

  if (category) {
    sql += " AND i.category_id = ?";
    params.push(category);
  }

  sql += " ORDER BY sales_per_day DESC LIMIT ?";
  params.push(limit);

  const data = db.prepare(sql).all(...params);
  return c.json({ data, days });
}
