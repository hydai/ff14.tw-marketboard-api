// Universalis API
export const UNIVERSALIS_BASE_URL = "https://universalis.app/api/v2";
export const UNIVERSALIS_MAX_ITEMS_PER_REQUEST = 100;
export const UNIVERSALIS_RATE_LIMIT = 25; // req/s
export const UNIVERSALIS_MAX_CONCURRENT = 8;

// XIVAPI
export const XIVAPI_BASE_URL = "https://v2.xivapi.com/api";
export const XIVAPI_BATCH_ROWS = 100; // items per ?rows= request

// Polling tiers
export interface TierConfig {
  tier: 1 | 2 | 3;
  frequencyMinutes: number;
  useAggregated: boolean;
}

export const TIER_CONFIGS: TierConfig[] = [
  { tier: 1, frequencyMinutes: 5, useAggregated: false },
  { tier: 2, frequencyMinutes: 10, useAggregated: false },
  { tier: 3, frequencyMinutes: 15, useAggregated: true },
];

// Batch sizes
export const QUEUE_BATCH_SIZE = 100; // items per queue message

// KV TTLs (seconds)
export const KV_TTL_LATEST_PRICE = 600;       // 10 min
export const KV_TTL_LISTINGS = 600;            // 10 min
export const KV_TTL_ANALYTICS = 600;           // 10 min
export const KV_TTL_MARKETABLE_ITEMS = 86400;  // 24 hours

// Data retention (days)
export const RETENTION_RAW_SNAPSHOTS = 14;
export const RETENTION_HOURLY_AGGREGATES = 90;
export const RETENTION_DAILY_AGGREGATES = 365;

// API pagination
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

// Analytics
export const ARBITRAGE_MIN_PROFIT_GIL = 1000;
export const ARBITRAGE_MIN_PROFIT_PCT = 5;
export const DEALS_MAX_PERCENTILE = 20;
export const TRENDING_MIN_CHANGE_PCT = 10;
export const VELOCITY_MIN_SALES_PER_DAY = 5;
