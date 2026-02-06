import { describe, it, expect } from "vitest";
import { KVCache } from "./kv";

describe("KVCache key builders", () => {
  it("latestPriceKey builds correct key", () => {
    expect(KVCache.latestPriceKey(123)).toBe("item:123:latest");
  });

  it("listingsKey builds correct key", () => {
    expect(KVCache.listingsKey(456)).toBe("item:456:listings");
  });

  it("arbitrageKey returns static key", () => {
    expect(KVCache.arbitrageKey()).toBe("arbitrage:top");
  });

  it("dealsKey returns static key", () => {
    expect(KVCache.dealsKey()).toBe("deals:top");
  });

  it("marketableItemsKey returns static key", () => {
    expect(KVCache.marketableItemsKey()).toBe("items:marketable");
  });
});
