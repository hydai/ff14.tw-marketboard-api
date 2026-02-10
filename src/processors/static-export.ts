import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { DC_LUHANGNIAO } from "../config/datacenters.js";
import {
  ARBITRAGE_MIN_PROFIT_GIL,
  ARBITRAGE_MIN_PROFIT_PCT,
  DEALS_MAX_PERCENTILE,
  VELOCITY_MIN_SALES_PER_DAY,
  DEFAULT_PAGE_SIZE,
} from "../config/constants.js";
import {
  getItemById,
  getLatestSnapshot,
  getListingsByItem,
  getListingsByItemAndWorld,
  getPriceHistory,
  getRecentSales,
  getTaxRates,
  getMeta,
  getItemsByTier,
  getArbitrageOpportunities,
  getDeals,
  getTrending,
  getVelocity,
} from "../db/queries.js";
import { getCollectionStats } from "../db/stats.js";
import { isoTimeAgo } from "../utils/datetime.js";
import { createLogger } from "../utils/logger.js";

// ── Types ─────────────────────────────────────

export interface ExportOptions {
  db: Database.Database;
  outputDir: string;
  tier?: number;
  historyPeriod: string;
  salesDays: number;
  analyticsLimit: number;
  itemsOnly: boolean;
  analyticsOnly: boolean;
  clean: boolean;
  pretty: boolean;
  verbose: boolean;
}

interface ExportManifest {
  generatedAt: string;
  datacenter: string;
  version: string;
  counts: {
    items: number;
    priceFiles: number;
    analyticsFiles: number;
  };
  endpoints: string[];
}

// ── Helpers ───────────────────────────────────

function writeJson(filePath: string, data: unknown, pretty: boolean): void {
  mkdirSync(join(filePath, ".."), { recursive: true });
  const json = pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
  writeFileSync(filePath, json, "utf-8");
}

function resolveHistoryHours(period: string): number {
  if (period.endsWith("d")) return parseInt(period) * 24;
  if (period.endsWith("h")) return parseInt(period);
  return 168; // default 7d
}

// ── Main Export ───────────────────────────────

export function runStaticExport(opts: ExportOptions): void {
  const log = createLogger("static-export", opts.verbose ? "debug" : "info");
  const base = join(opts.outputDir, "api", "v1");
  const startTime = Date.now();

  if (opts.clean) {
    log.info("Cleaning output directory", { dir: opts.outputDir });
    rmSync(opts.outputDir, { recursive: true, force: true });
  }

  mkdirSync(base, { recursive: true });

  // Collect item IDs to export
  const itemIds = collectItemIds(opts.db, opts.tier, log);
  log.info("Items to export", { count: itemIds.length, tier: opts.tier ?? "all" });

  let priceFileCount = 0;
  let analyticsFileCount = 0;

  // ── Phase 1: Static data ──────────────────
  log.info("Phase 1: Static data");
  exportStaticData(opts.db, base, opts.pretty);

  // ── Phase 2: Item catalog ─────────────────
  if (!opts.analyticsOnly) {
    log.info("Phase 2: Item catalog");
    exportItemCatalog(opts.db, base, itemIds, opts.pretty);
  }

  // ── Phase 3: Per-item data ────────────────
  if (!opts.analyticsOnly) {
    log.info("Phase 3: Per-item data", { items: itemIds.length });
    const historyHours = resolveHistoryHours(opts.historyPeriod);

    for (let i = 0; i < itemIds.length; i++) {
      const itemId = itemIds[i]!;
      const filesWritten = exportItemData(opts.db, base, itemId, historyHours, opts.salesDays, opts.pretty);
      priceFileCount += filesWritten;

      if ((i + 1) % 500 === 0 || i + 1 === itemIds.length) {
        log.info("Per-item progress", { completed: i + 1, total: itemIds.length, files: priceFileCount });
      }
    }
  }

  // ── Phase 4: Analytics ────────────────────
  if (!opts.itemsOnly) {
    log.info("Phase 4: Analytics");
    analyticsFileCount = exportAnalytics(opts.db, base, opts.analyticsLimit, opts.pretty);
  }

  // ── Phase 5: Manifest ─────────────────────
  const endpoints = buildEndpointList(opts.itemsOnly, opts.analyticsOnly);
  const manifest: ExportManifest = {
    generatedAt: new Date().toISOString(),
    datacenter: DC_LUHANGNIAO.name,
    version: "v1",
    counts: {
      items: itemIds.length,
      priceFiles: priceFileCount,
      analyticsFiles: analyticsFileCount,
    },
    endpoints,
  };
  writeJson(join(base, "manifest.json"), manifest, opts.pretty);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log.info("Export complete", {
    items: itemIds.length,
    priceFiles: priceFileCount,
    analyticsFiles: analyticsFileCount,
    elapsedSeconds: elapsed,
    outputDir: opts.outputDir,
  });
}

// ── Phase helpers ─────────────────────────────

function collectItemIds(
  db: Database.Database,
  tier: number | undefined,
  log: ReturnType<typeof createLogger>
): number[] {
  if (tier) {
    const rows = getItemsByTier(db, tier);
    log.debug("Filtered by tier", { tier, count: rows.length });
    return rows.map((r) => r.item_id);
  }

  // All items that have tiers assigned
  const rows = db
    .prepare("SELECT DISTINCT item_id FROM item_tiers ORDER BY item_id")
    .all() as { item_id: number }[];
  return rows.map((r) => r.item_id);
}

function exportStaticData(db: Database.Database, base: string, pretty: boolean): void {
  // worlds.json
  writeJson(join(base, "worlds.json"), {
    data: DC_LUHANGNIAO.worlds.map((w) => ({
      id: w.id,
      name: w.name,
      nameEn: w.nameEn,
    })),
  }, pretty);

  // tax-rates.json
  const taxRates = getTaxRates(db);
  writeJson(join(base, "tax-rates.json"), { data: taxRates }, pretty);

  // status.json
  const lastPoll = getMeta(db, "last_poll_time");
  const lastMaintenance = getMeta(db, "last_maintenance");
  const lastItemSync = getMeta(db, "last_item_sync");
  writeJson(join(base, "status.json"), {
    datacenter: DC_LUHANGNIAO.name,
    lastPollTime: lastPoll?.value ?? null,
    lastMaintenance: lastMaintenance?.value ?? null,
    lastItemSync: lastItemSync?.value ?? null,
  }, pretty);

  // stats.json
  const stats = getCollectionStats(db);
  writeJson(join(base, "stats.json"), stats, pretty);
}

function exportItemCatalog(
  db: Database.Database,
  base: string,
  itemIds: number[],
  pretty: boolean
): void {
  // Build compact catalog
  const catalog: { item_id: number; name_en: string | null; name_zh: string | null; tier: number | null }[] = [];
  for (const itemId of itemIds) {
    const item = getItemById(db, itemId) as {
      item_id: number;
      name_en: string | null;
      name_zh: string | null;
    } | undefined;
    const tierRow = db.prepare("SELECT tier FROM item_tiers WHERE item_id = ?").get(itemId) as { tier: number } | undefined;

    if (item) {
      catalog.push({
        item_id: item.item_id,
        name_en: item.name_en ?? null,
        name_zh: item.name_zh ?? null,
        tier: tierRow?.tier ?? null,
      });
    }
  }

  // items/index.json — full compact catalog
  writeJson(join(base, "items", "index.json"), { data: catalog }, pretty);

  // items/page/N.json — paginated
  const pageSize = DEFAULT_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(catalog.length / pageSize));
  for (let page = 1; page <= totalPages; page++) {
    const slice = catalog.slice((page - 1) * pageSize, page * pageSize);
    writeJson(join(base, "items", "page", `${page}.json`), {
      data: slice,
      pagination: { page, totalPages, totalItems: catalog.length, pageSize },
    }, pretty);
  }
}

function exportItemData(
  db: Database.Database,
  base: string,
  itemId: number,
  historyHours: number,
  salesDays: number,
  pretty: boolean
): number {
  let fileCount = 0;
  const itemBase = join(base, "items", `${itemId}.json`);
  const priceBase = join(base, "prices", `${itemId}`);

  // items/<itemId>.json — item info + latest snapshot
  const item = getItemById(db, itemId);
  const snapshot = getLatestSnapshot(db, itemId);
  writeJson(itemBase, { data: item, latestSnapshot: snapshot ?? null }, pretty);
  fileCount++;

  // prices/<itemId>/index.json — all current listings
  const listings = getListingsByItem(db, itemId);
  writeJson(join(priceBase, "index.json"), { data: listings }, pretty);
  fileCount++;

  // prices/<itemId>/history.json — hourly price history
  const since = isoTimeAgo(historyHours);
  const history = getPriceHistory(db, itemId, { since, resolution: "hourly" });
  writeJson(join(priceBase, "history.json"), { data: history }, pretty);
  fileCount++;

  // prices/<itemId>/sales.json — recent sales
  const sales = getRecentSales(db, itemId, { days: salesDays });
  writeJson(join(priceBase, "sales.json"), { data: sales }, pretty);
  fileCount++;

  // prices/<itemId>/world/<WorldName>.json — per-world listings
  for (const world of DC_LUHANGNIAO.worlds) {
    const worldListings = getListingsByItemAndWorld(db, itemId, world.id);
    writeJson(join(priceBase, "world", `${world.nameEn}.json`), { data: worldListings }, pretty);
    fileCount++;
  }

  return fileCount;
}

function exportAnalytics(
  db: Database.Database,
  base: string,
  limit: number,
  pretty: boolean
): number {
  let fileCount = 0;

  // arbitrage.json
  const arbitrage = getArbitrageOpportunities(db, {
    minProfit: ARBITRAGE_MIN_PROFIT_GIL,
    minProfitPct: ARBITRAGE_MIN_PROFIT_PCT,
    limit,
  });
  writeJson(join(base, "arbitrage.json"), { data: arbitrage }, pretty);
  fileCount++;

  // deals.json
  const deals = getDeals(db, { maxPercentile: DEALS_MAX_PERCENTILE, limit });
  writeJson(join(base, "deals.json"), { data: deals }, pretty);
  fileCount++;

  // trending/up.json + trending/down.json
  for (const direction of ["up", "down"] as const) {
    const trending = getTrending(db, { direction, period: "3d", limit });
    writeJson(join(base, "trending", `${direction}.json`), { data: trending }, pretty);
    fileCount++;
  }

  // velocity.json
  const velocity = getVelocity(db, {
    days: 7,
    minSales: VELOCITY_MIN_SALES_PER_DAY,
    limit,
  });
  writeJson(join(base, "velocity.json"), { data: velocity }, pretty);
  fileCount++;

  return fileCount;
}

function buildEndpointList(itemsOnly: boolean, analyticsOnly: boolean): string[] {
  const endpoints: string[] = [
    "manifest.json",
    "worlds.json",
    "tax-rates.json",
    "status.json",
    "stats.json",
  ];

  if (!analyticsOnly) {
    endpoints.push(
      "items/index.json",
      "items/page/{n}.json",
      "items/{itemId}.json",
      "prices/{itemId}/index.json",
      "prices/{itemId}/history.json",
      "prices/{itemId}/sales.json",
      "prices/{itemId}/world/{worldName}.json",
    );
  }

  if (!itemsOnly) {
    endpoints.push(
      "arbitrage.json",
      "deals.json",
      "trending/up.json",
      "trending/down.json",
      "velocity.json",
    );
  }

  return endpoints;
}
