-- Item metadata (synced daily from XIVAPI)
CREATE TABLE IF NOT EXISTS items (
  item_id INTEGER PRIMARY KEY,
  name_en TEXT NOT NULL DEFAULT '',
  name_ja TEXT NOT NULL DEFAULT '',
  name_zh TEXT NOT NULL DEFAULT '',
  icon_path TEXT NOT NULL DEFAULT '',
  category_id INTEGER,
  category_name TEXT,
  is_hq_available INTEGER NOT NULL DEFAULT 0,
  stack_size INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_items_category ON items(category_id);
CREATE INDEX idx_items_name_en ON items(name_en);
CREATE INDEX idx_items_name_zh ON items(name_zh);

-- Current market listings (replaced each poll)
CREATE TABLE IF NOT EXISTS current_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  world_id INTEGER NOT NULL,
  world_name TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  price_per_unit INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  total INTEGER NOT NULL,
  tax INTEGER NOT NULL DEFAULT 0,
  hq INTEGER NOT NULL DEFAULT 0,
  retainer_name TEXT NOT NULL DEFAULT '',
  retainer_city INTEGER NOT NULL DEFAULT 0,
  creator_name TEXT NOT NULL DEFAULT '',
  last_review_time TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, world_id, listing_id)
);

CREATE INDEX idx_listings_item ON current_listings(item_id);
CREATE INDEX idx_listings_item_world ON current_listings(item_id, world_id);
CREATE INDEX idx_listings_price ON current_listings(item_id, price_per_unit);

-- DC-level price snapshots (one row per item per poll)
CREATE TABLE IF NOT EXISTS price_snapshots (
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

CREATE INDEX idx_snapshots_item_time ON price_snapshots(item_id, snapshot_time);
CREATE INDEX idx_snapshots_time ON price_snapshots(snapshot_time);

-- Per-world snapshots (for arbitrage)
CREATE TABLE IF NOT EXISTS world_price_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  world_id INTEGER NOT NULL,
  world_name TEXT NOT NULL,
  snapshot_time TEXT NOT NULL,
  min_price_nq INTEGER,
  min_price_hq INTEGER,
  avg_price_nq REAL,
  avg_price_hq REAL,
  listing_count INTEGER NOT NULL DEFAULT 0,
  units_for_sale INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_world_snapshots_item_time ON world_price_snapshots(item_id, snapshot_time);
CREATE INDEX idx_world_snapshots_world ON world_price_snapshots(world_id, snapshot_time);

-- Sales history (append-only, deduplicated)
CREATE TABLE IF NOT EXISTS sales_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  world_id INTEGER NOT NULL,
  world_name TEXT NOT NULL,
  price_per_unit INTEGER NOT NULL,
  quantity INTEGER NOT NULL,
  total INTEGER NOT NULL,
  hq INTEGER NOT NULL DEFAULT 0,
  buyer_name TEXT NOT NULL DEFAULT '',
  sold_at TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(item_id, world_id, sold_at, price_per_unit, quantity, hq)
);

CREATE INDEX idx_sales_item_time ON sales_history(item_id, sold_at);
CREATE INDEX idx_sales_world ON sales_history(world_id, sold_at);

-- Hourly aggregates
CREATE TABLE IF NOT EXISTS hourly_aggregates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  hour_timestamp TEXT NOT NULL,
  min_price_nq INTEGER,
  min_price_hq INTEGER,
  avg_price_nq REAL,
  avg_price_hq REAL,
  max_price_nq INTEGER,
  max_price_hq INTEGER,
  total_listings INTEGER NOT NULL DEFAULT 0,
  total_sales INTEGER NOT NULL DEFAULT 0,
  total_sales_gil INTEGER NOT NULL DEFAULT 0,
  UNIQUE(item_id, hour_timestamp)
);

CREATE INDEX idx_hourly_item_time ON hourly_aggregates(item_id, hour_timestamp);

-- Daily aggregates
CREATE TABLE IF NOT EXISTS daily_aggregates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL,
  day_timestamp TEXT NOT NULL,
  min_price_nq INTEGER,
  min_price_hq INTEGER,
  avg_price_nq REAL,
  avg_price_hq REAL,
  max_price_nq INTEGER,
  max_price_hq INTEGER,
  total_listings INTEGER NOT NULL DEFAULT 0,
  total_sales INTEGER NOT NULL DEFAULT 0,
  total_sales_gil INTEGER NOT NULL DEFAULT 0,
  UNIQUE(item_id, day_timestamp)
);

CREATE INDEX idx_daily_item_time ON daily_aggregates(item_id, day_timestamp);

-- Tax rates per world
CREATE TABLE IF NOT EXISTS tax_rates (
  world_id INTEGER PRIMARY KEY,
  world_name TEXT NOT NULL,
  limsa INTEGER NOT NULL DEFAULT 0,
  gridania INTEGER NOT NULL DEFAULT 0,
  uldah INTEGER NOT NULL DEFAULT 0,
  ishgard INTEGER NOT NULL DEFAULT 0,
  kugane INTEGER NOT NULL DEFAULT 0,
  crystarium INTEGER NOT NULL DEFAULT 0,
  sharlayan INTEGER NOT NULL DEFAULT 0,
  tuliyollal INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- System state tracking
CREATE TABLE IF NOT EXISTS system_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Item tier assignments for polling
CREATE TABLE IF NOT EXISTS item_tiers (
  item_id INTEGER PRIMARY KEY,
  tier INTEGER NOT NULL DEFAULT 3 CHECK(tier IN (1, 2, 3)),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_item_tiers_tier ON item_tiers(tier);
