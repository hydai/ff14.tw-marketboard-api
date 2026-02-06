import { Context } from "hono";
import type { Env } from "../../env";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../../config/constants";
import { KVCache } from "../../cache/kv";
import { getItemById, getLatestSnapshot, searchItems } from "../../db/queries";
import { HTTPError } from "../middleware";

export async function listItems(c: Context<{ Bindings: Env }>) {
  const search = c.req.query("search");
  const category = c.req.query("category");
  const page = Math.max(1, Number(c.req.query("page")) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(c.req.query("limit")) || DEFAULT_PAGE_SIZE));

  const { count, data } = searchItems(c.env.DB, {
    search,
    category: category ? Number(category) : undefined,
    page,
    limit,
  });

  const [countResult, dataResult] = await Promise.all([
    count.first<{ total: number }>(),
    data.all(),
  ]);

  return c.json({
    data: dataResult.results,
    total: countResult?.total ?? 0,
    page,
    limit,
  });
}

export async function getItem(c: Context<{ Bindings: Env }>) {
  const itemId = Number(c.req.param("itemId"));
  if (isNaN(itemId)) throw new HTTPError(400, "Invalid item ID");

  const item = await getItemById(c.env.DB, itemId);
  if (!item) throw new HTTPError(404, "Item not found");

  // Try KV cache for latest price, fallback to D1
  const kv = new KVCache(c.env.KV);
  let priceSummary = await kv.getJSON(KVCache.latestPriceKey(itemId));
  if (!priceSummary) {
    priceSummary = await getLatestSnapshot(c.env.DB, itemId);
  }

  return c.json({
    data: {
      ...item,
      priceSummary,
    },
  });
}
