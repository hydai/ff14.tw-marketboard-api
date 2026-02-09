import type Database from "better-sqlite3";
import { isoTimeAgo } from "../utils/datetime.js";

interface TableCounts {
  items: number;
  currentListings: number;
  priceSnapshots: number;
  salesHistory: number;
  hourlyAggregates: number;
  dailyAggregates: number;
  itemTiers: number;
}

interface TierCounts {
  tier1: number;
  tier2: number;
  tier3: number;
}

interface FreshnessStats {
  itemsWithRecentSnapshots: number;
  oldestSnapshotAge: string | null;
  newestSnapshotAge: string | null;
  itemsWithListings: number;
}

interface StatsResult {
  tables: TableCounts;
  tiers: TierCounts;
  freshness: FreshnessStats;
}

export function getCollectionStats(db: Database.Database): StatsResult {
  const cnt = (sql: string, ...params: unknown[]): number => {
    const row = db.prepare(sql).get(...params) as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  };

  const val = (sql: string): string | null => {
    const row = db.prepare(sql).get() as { val: string | null } | undefined;
    return row?.val ?? null;
  };

  const recentCutoff = isoTimeAgo(0.25);

  return {
    tables: {
      items: cnt("SELECT COUNT(*) as cnt FROM items"),
      currentListings: cnt("SELECT COUNT(*) as cnt FROM current_listings"),
      priceSnapshots: cnt("SELECT COUNT(*) as cnt FROM price_snapshots"),
      salesHistory: cnt("SELECT COUNT(*) as cnt FROM sales_history"),
      hourlyAggregates: cnt("SELECT COUNT(*) as cnt FROM hourly_aggregates"),
      dailyAggregates: cnt("SELECT COUNT(*) as cnt FROM daily_aggregates"),
      itemTiers: cnt("SELECT COUNT(*) as cnt FROM item_tiers"),
    },
    tiers: {
      tier1: cnt("SELECT COUNT(*) as cnt FROM item_tiers WHERE tier = 1"),
      tier2: cnt("SELECT COUNT(*) as cnt FROM item_tiers WHERE tier = 2"),
      tier3: cnt("SELECT COUNT(*) as cnt FROM item_tiers WHERE tier = 3"),
    },
    freshness: {
      itemsWithRecentSnapshots: cnt(
        "SELECT COUNT(DISTINCT item_id) as cnt FROM price_snapshots WHERE snapshot_time >= ?",
        recentCutoff
      ),
      oldestSnapshotAge: val("SELECT MIN(snapshot_time) as val FROM price_snapshots"),
      newestSnapshotAge: val("SELECT MAX(snapshot_time) as val FROM price_snapshots"),
      itemsWithListings: cnt("SELECT COUNT(DISTINCT item_id) as cnt FROM current_listings"),
    },
  };
}
