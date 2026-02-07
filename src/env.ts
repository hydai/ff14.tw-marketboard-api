export interface Env {
  // D1 Database
  DB: D1Database;

  // KV Namespace
  KV: KVNamespace;

  // Queue Producer
  MARKET_QUEUE: Queue<QueueMessage>;

  // Environment variables
  DATACENTER_ID: string;
  DATACENTER_NAME: string;
  REGION_CODE: string;
  ENVIRONMENT: string;
}

export type QueueMessage =
  | FetchPricesMessage
  | FetchAggregatedMessage
  | ComputeAnalyticsMessage
  | SyncItemsMessage;

export interface FetchPricesMessage {
  type: "fetch-prices";
  itemIds: number[];
  tier: 1 | 2 | 3;
}

export interface FetchAggregatedMessage {
  type: "fetch-aggregated";
  itemIds: number[];
}

export interface ComputeAnalyticsMessage {
  type: "compute-analytics";
  kind: "arbitrage" | "deals" | "trending" | "velocity";
}

export interface SyncItemsMessage {
  type: "sync-items";
  itemIds: number[];
  isNew: boolean;
}
