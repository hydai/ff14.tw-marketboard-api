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

export async function getCollectionStats(db: D1Database): Promise<StatsResult> {
  // Run all count queries in a single D1 batch round-trip
  const results = await db.batch([
    // 0-6: Table row counts
    db.prepare("SELECT COUNT(*) as cnt FROM items"),
    db.prepare("SELECT COUNT(*) as cnt FROM current_listings"),
    db.prepare("SELECT COUNT(*) as cnt FROM price_snapshots"),
    db.prepare("SELECT COUNT(*) as cnt FROM sales_history"),
    db.prepare("SELECT COUNT(*) as cnt FROM hourly_aggregates"),
    db.prepare("SELECT COUNT(*) as cnt FROM daily_aggregates"),
    db.prepare("SELECT COUNT(*) as cnt FROM item_tiers"),

    // 7-9: Tier distribution
    db.prepare("SELECT COUNT(*) as cnt FROM item_tiers WHERE tier = 1"),
    db.prepare("SELECT COUNT(*) as cnt FROM item_tiers WHERE tier = 2"),
    db.prepare("SELECT COUNT(*) as cnt FROM item_tiers WHERE tier = 3"),

    // 10: Items with snapshots in the last 15 minutes
    db.prepare(
      "SELECT COUNT(DISTINCT item_id) as cnt FROM price_snapshots WHERE snapshot_time >= datetime('now', '-15 minutes')"
    ),

    // 11: Oldest snapshot time
    db.prepare("SELECT MIN(snapshot_time) as val FROM price_snapshots"),

    // 12: Newest snapshot time
    db.prepare("SELECT MAX(snapshot_time) as val FROM price_snapshots"),

    // 13: Items with at least one current listing
    db.prepare("SELECT COUNT(DISTINCT item_id) as cnt FROM current_listings"),
  ]);

  const cnt = (idx: number): number => {
    const row = results[idx]?.results?.[0] as { cnt: number } | undefined;
    return row?.cnt ?? 0;
  };

  const val = (idx: number): string | null => {
    const row = results[idx]?.results?.[0] as { val: string | null } | undefined;
    return row?.val ?? null;
  };

  return {
    tables: {
      items: cnt(0),
      currentListings: cnt(1),
      priceSnapshots: cnt(2),
      salesHistory: cnt(3),
      hourlyAggregates: cnt(4),
      dailyAggregates: cnt(5),
      itemTiers: cnt(6),
    },
    tiers: {
      tier1: cnt(7),
      tier2: cnt(8),
      tier3: cnt(9),
    },
    freshness: {
      itemsWithRecentSnapshots: cnt(10),
      oldestSnapshotAge: val(11),
      newestSnapshotAge: val(12),
      itemsWithListings: cnt(13),
    },
  };
}
