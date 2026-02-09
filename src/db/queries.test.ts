import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { getTrending } from "./queries.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");

  db.exec(`
    CREATE TABLE items (
      item_id INTEGER PRIMARY KEY,
      name_en TEXT NOT NULL DEFAULT '',
      name_zh TEXT NOT NULL DEFAULT '',
      category_id INTEGER
    );

    CREATE TABLE price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL,
      snapshot_time TEXT NOT NULL,
      min_price_nq INTEGER,
      min_price_hq INTEGER,
      avg_price_nq REAL,
      avg_price_hq REAL,
      listing_count INTEGER NOT NULL DEFAULT 0,
      units_for_sale INTEGER NOT NULL DEFAULT 0,
      sale_velocity_nq REAL NOT NULL DEFAULT 0,
      sale_velocity_hq REAL NOT NULL DEFAULT 0,
      cheapest_world_id INTEGER,
      cheapest_world_name TEXT
    );
  `);

  return db;
}

describe("getTrending", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("returns trending up items when prices increase >10%", () => {
    db.prepare("INSERT INTO items (item_id, name_zh) VALUES (?, ?)").run(1, "測試物品");

    const now = Date.now();
    const insertSnapshot = db.prepare(
      "INSERT INTO price_snapshots (item_id, snapshot_time, avg_price_nq, listing_count) VALUES (?, ?, ?, 10)"
    );

    // "Older" window: 18-24 hours ago, avg price ~1000
    for (let h = 18; h <= 24; h += 2) {
      const ts = new Date(now - h * 3600000).toISOString();
      insertSnapshot.run(1, ts, 1000);
    }

    // "Recent" window: 0-11 hours ago, avg price ~1500 (50% increase)
    for (let h = 0; h <= 11; h += 2) {
      const ts = new Date(now - h * 3600000).toISOString();
      insertSnapshot.run(1, ts, 1500);
    }

    const result = getTrending(db, {
      direction: "up",
      period: "1d",
      limit: 10,
    });

    expect(result.length).toBeGreaterThan(0);
    const row = result[0] as { item_id: number; change_pct: number; item_name: string };
    expect(row.item_id).toBe(1);
    expect(row.change_pct).toBe(50);
    expect(row.item_name).toBe("測試物品");
  });

  it("returns trending down items when prices decrease >10%", () => {
    db.prepare("INSERT INTO items (item_id, name_zh) VALUES (?, ?)").run(2, "降價物品");

    const now = Date.now();
    const insertSnapshot = db.prepare(
      "INSERT INTO price_snapshots (item_id, snapshot_time, avg_price_nq, listing_count) VALUES (?, ?, ?, 10)"
    );

    // "Older" window: 18-24 hours ago, avg price ~2000
    for (let h = 18; h <= 24; h += 2) {
      insertSnapshot.run(2, new Date(now - h * 3600000).toISOString(), 2000);
    }

    // "Recent" window: 0-11 hours ago, avg price ~1000 (50% decrease)
    for (let h = 0; h <= 11; h += 2) {
      insertSnapshot.run(2, new Date(now - h * 3600000).toISOString(), 1000);
    }

    const result = getTrending(db, {
      direction: "down",
      period: "1d",
      limit: 10,
    });

    expect(result.length).toBeGreaterThan(0);
    const row = result[0] as { item_id: number; change_pct: number };
    expect(row.item_id).toBe(2);
    expect(row.change_pct).toBe(-50);
  });

  it("excludes items with <10% change", () => {
    db.prepare("INSERT INTO items (item_id, name_zh) VALUES (?, ?)").run(3, "穩定物品");

    const now = Date.now();
    const insertSnapshot = db.prepare(
      "INSERT INTO price_snapshots (item_id, snapshot_time, avg_price_nq, listing_count) VALUES (?, ?, ?, 10)"
    );

    // Both windows have nearly the same price (~5% change)
    for (let h = 18; h <= 24; h += 2) {
      insertSnapshot.run(3, new Date(now - h * 3600000).toISOString(), 1000);
    }
    for (let h = 0; h <= 11; h += 2) {
      insertSnapshot.run(3, new Date(now - h * 3600000).toISOString(), 1050);
    }

    const result = getTrending(db, {
      direction: "up",
      period: "1d",
      limit: 10,
    });

    expect(result.length).toBe(0);
  });

  it("correctly splits windows with ISO timestamps (the core fix)", () => {
    db.prepare("INSERT INTO items (item_id, name_zh) VALUES (?, ?)").run(4, "核心測試");

    const now = Date.now();
    const midpointMs = now - 12 * 3600000; // 12 hours ago
    const insertSnapshot = db.prepare(
      "INSERT INTO price_snapshots (item_id, snapshot_time, avg_price_nq, listing_count) VALUES (?, ?, ?, 10)"
    );

    // Insert data just BEFORE the midpoint (should be "older")
    // This is the case that was broken: same calendar date, earlier time
    insertSnapshot.run(4, new Date(midpointMs - 1 * 3600000).toISOString(), 1000); // 13h ago
    insertSnapshot.run(4, new Date(midpointMs - 2 * 3600000).toISOString(), 1000); // 14h ago
    insertSnapshot.run(4, new Date(midpointMs - 3 * 3600000).toISOString(), 1000); // 15h ago

    // Insert data just AFTER the midpoint (should be "recent")
    insertSnapshot.run(4, new Date(midpointMs + 1 * 3600000).toISOString(), 1500); // 11h ago
    insertSnapshot.run(4, new Date(midpointMs + 2 * 3600000).toISOString(), 1500); // 10h ago
    insertSnapshot.run(4, new Date(midpointMs + 3 * 3600000).toISOString(), 1500); // 9h ago

    const result = getTrending(db, {
      direction: "up",
      period: "1d",
      limit: 10,
    });

    expect(result.length).toBe(1);
    const row = result[0] as { item_id: number; change_pct: number };
    expect(row.item_id).toBe(4);
    expect(row.change_pct).toBe(50);
  });

  it("filters by category when provided", () => {
    db.prepare("INSERT INTO items (item_id, name_zh, category_id) VALUES (?, ?, ?)").run(5, "武器", 10);
    db.prepare("INSERT INTO items (item_id, name_zh, category_id) VALUES (?, ?, ?)").run(6, "防具", 20);

    const now = Date.now();
    const insertSnapshot = db.prepare(
      "INSERT INTO price_snapshots (item_id, snapshot_time, avg_price_nq, listing_count) VALUES (?, ?, ?, 10)"
    );

    for (const itemId of [5, 6]) {
      for (let h = 18; h <= 24; h += 2) {
        insertSnapshot.run(itemId, new Date(now - h * 3600000).toISOString(), 1000);
      }
      for (let h = 0; h <= 11; h += 2) {
        insertSnapshot.run(itemId, new Date(now - h * 3600000).toISOString(), 1500);
      }
    }

    const result = getTrending(db, {
      direction: "up",
      period: "1d",
      category: 10,
      limit: 10,
    });

    expect(result.length).toBe(1);
    expect((result[0] as { item_id: number }).item_id).toBe(5);
  });
});
