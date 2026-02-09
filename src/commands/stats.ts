import { resolve } from "node:path";
import { openDatabase, runMigrations } from "../db/database.js";
import { getCollectionStats } from "../db/stats.js";
import { getMeta } from "../db/queries.js";
import { DC_LUHANGNIAO } from "../config/datacenters.js";

interface StatsOptions {
  db: string;
}

export function statsCommand(opts: StatsOptions): void {
  const dbPath = resolve(opts.db);
  const db = openDatabase(dbPath);
  const migrationsDir = resolve(import.meta.dirname, "../../migrations");
  runMigrations(db, migrationsDir);

  const stats = getCollectionStats(db);
  const lastPoll = getMeta(db, "last_poll_time");
  const lastMaintenance = getMeta(db, "last_maintenance");
  const lastItemSync = getMeta(db, "last_item_sync");

  console.log(`\n=== FFXIV Market Board Statistics ===`);
  console.log(`Datacenter: ${DC_LUHANGNIAO.name}`);
  console.log(`Database: ${dbPath}\n`);

  console.log("── Tables ──────────────────────────");
  console.log(`  Items:              ${stats.tables.items.toLocaleString()}`);
  console.log(`  Current Listings:   ${stats.tables.currentListings.toLocaleString()}`);
  console.log(`  Price Snapshots:    ${stats.tables.priceSnapshots.toLocaleString()}`);
  console.log(`  Sales History:      ${stats.tables.salesHistory.toLocaleString()}`);
  console.log(`  Hourly Aggregates:  ${stats.tables.hourlyAggregates.toLocaleString()}`);
  console.log(`  Daily Aggregates:   ${stats.tables.dailyAggregates.toLocaleString()}`);
  console.log(`  Item Tiers:         ${stats.tables.itemTiers.toLocaleString()}`);

  console.log("\n── Tiers ───────────────────────────");
  console.log(`  Tier 1 (high velocity):  ${stats.tiers.tier1.toLocaleString()}`);
  console.log(`  Tier 2 (medium):         ${stats.tiers.tier2.toLocaleString()}`);
  console.log(`  Tier 3 (low/aggregated): ${stats.tiers.tier3.toLocaleString()}`);

  console.log("\n── Freshness ───────────────────────");
  console.log(`  Items with recent snapshots: ${stats.freshness.itemsWithRecentSnapshots.toLocaleString()}`);
  console.log(`  Items with listings:         ${stats.freshness.itemsWithListings.toLocaleString()}`);
  console.log(`  Oldest snapshot:             ${stats.freshness.oldestSnapshotAge ?? "N/A"}`);
  console.log(`  Newest snapshot:             ${stats.freshness.newestSnapshotAge ?? "N/A"}`);

  console.log("\n── System ──────────────────────────");
  console.log(`  Last poll:        ${lastPoll?.value ?? "never"}`);
  console.log(`  Last maintenance: ${lastMaintenance?.value ?? "never"}`);
  console.log(`  Last item sync:   ${lastItemSync?.value ?? "never"}`);

  console.log("");

  db.close();
}
