import { Context } from "hono";
import type Database from "better-sqlite3";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants.js";
import { getItemById, getLatestSnapshot, searchItems } from "../../db/queries.js";
import { buildIconUrl } from "../../utils/icon.js";
import { HTTPError } from "../middleware.js";

type AppEnv = { Variables: { db: Database.Database } };

export function listItems(c: Context<AppEnv>) {
  const db = c.get("db");
  const search = c.req.query("search");
  const category = c.req.query("category");
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query("limit")) || DEFAULT_PAGE_SIZE));

  const result = searchItems(db, {
    search,
    category: category ? Number(category) : undefined,
    page,
    limit,
  });

  const data = result.data.map((row) => {
    const item = row as Record<string, unknown>;
    return { ...item, icon_url: buildIconUrl(item.icon_path as string ?? "") };
  });

  return c.json({
    data,
    total: result.total,
    page,
    limit,
  });
}

export function getItem(c: Context<AppEnv>) {
  const db = c.get("db");
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) throw new HTTPError(400, "Invalid item ID");

  const item = getItemById(db, itemId);
  if (!item) throw new HTTPError(404, "Item not found");

  const priceSummary = getLatestSnapshot(db, itemId);

  const itemRecord = item as Record<string, unknown>;
  return c.json({
    data: {
      ...itemRecord,
      icon_url: buildIconUrl(itemRecord.icon_path as string ?? ""),
      priceSummary,
    },
  });
}
