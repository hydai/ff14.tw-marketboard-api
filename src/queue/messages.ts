import type { FetchPricesMessage, FetchAggregatedMessage, ComputeAnalyticsMessage } from "../env";

export function createFetchPricesMessage(itemIds: number[], tier: 1 | 2 | 3): FetchPricesMessage {
  return { type: "fetch-prices", itemIds, tier };
}

export function createFetchAggregatedMessage(itemIds: number[]): FetchAggregatedMessage {
  return { type: "fetch-aggregated", itemIds };
}

export function createComputeAnalyticsMessage(
  kind: "arbitrage" | "deals" | "trending" | "velocity"
): ComputeAnalyticsMessage {
  return { type: "compute-analytics", kind };
}
