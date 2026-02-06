import { describe, it, expect } from "vitest";
import {
  createFetchPricesMessage,
  createFetchAggregatedMessage,
  createComputeAnalyticsMessage,
} from "./messages";

describe("createFetchPricesMessage", () => {
  it("creates a fetch-prices message with tier 1", () => {
    const msg = createFetchPricesMessage([1, 2, 3], 1);
    expect(msg).toEqual({ type: "fetch-prices", itemIds: [1, 2, 3], tier: 1 });
  });

  it("creates a fetch-prices message with tier 2", () => {
    const msg = createFetchPricesMessage([10, 20], 2);
    expect(msg).toEqual({ type: "fetch-prices", itemIds: [10, 20], tier: 2 });
  });

  it("creates a fetch-prices message with tier 3", () => {
    const msg = createFetchPricesMessage([100], 3);
    expect(msg).toEqual({ type: "fetch-prices", itemIds: [100], tier: 3 });
  });

  it("handles empty item array", () => {
    const msg = createFetchPricesMessage([], 1);
    expect(msg).toEqual({ type: "fetch-prices", itemIds: [], tier: 1 });
  });

  it("handles large item array", () => {
    const ids = Array.from({ length: 100 }, (_, i) => i + 1);
    const msg = createFetchPricesMessage(ids, 2);
    expect(msg.itemIds).toHaveLength(100);
    expect(msg.type).toBe("fetch-prices");
  });
});

describe("createFetchAggregatedMessage", () => {
  it("creates a fetch-aggregated message", () => {
    const msg = createFetchAggregatedMessage([5, 10, 15]);
    expect(msg).toEqual({ type: "fetch-aggregated", itemIds: [5, 10, 15] });
  });

  it("handles empty item array", () => {
    const msg = createFetchAggregatedMessage([]);
    expect(msg).toEqual({ type: "fetch-aggregated", itemIds: [] });
  });
});

describe("createComputeAnalyticsMessage", () => {
  it("creates arbitrage analytics message", () => {
    expect(createComputeAnalyticsMessage("arbitrage")).toEqual({
      type: "compute-analytics",
      kind: "arbitrage",
    });
  });

  it("creates deals analytics message", () => {
    expect(createComputeAnalyticsMessage("deals")).toEqual({
      type: "compute-analytics",
      kind: "deals",
    });
  });

  it("creates trending analytics message", () => {
    expect(createComputeAnalyticsMessage("trending")).toEqual({
      type: "compute-analytics",
      kind: "trending",
    });
  });

  it("creates velocity analytics message", () => {
    expect(createComputeAnalyticsMessage("velocity")).toEqual({
      type: "compute-analytics",
      kind: "velocity",
    });
  });
});
