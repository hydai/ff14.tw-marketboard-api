import { describe, it, expect } from "vitest";
import { median, percentile, average, profitAfterTax, chunk } from "./math";

describe("median", () => {
  it("returns 0 for empty array", () => {
    expect(median([])).toBe(0);
  });

  it("returns the single value", () => {
    expect(median([42])).toBe(42);
  });

  it("returns the middle value for odd count", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("returns average of two middles for even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("does not mutate the original array", () => {
    const arr = [3, 1, 2];
    median(arr);
    expect(arr).toEqual([3, 1, 2]);
  });
});

describe("percentile", () => {
  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });

  it("returns min value at p=0", () => {
    expect(percentile([10, 20, 30, 40, 50], 0)).toBe(10);
  });

  it("returns median at p=50", () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });

  it("returns max value at p=100", () => {
    expect(percentile([10, 20, 30, 40, 50], 100)).toBe(50);
  });

  it("interpolates between values", () => {
    // p=25 on [10, 20, 30, 40, 50]: index = 0.25 * 4 = 1.0 → sorted[1] = 20
    expect(percentile([10, 20, 30, 40, 50], 25)).toBe(20);
  });

  it("interpolates fractional index", () => {
    // p=10 on [10, 20, 30, 40, 50]: index = 0.1 * 4 = 0.4 → 10 + (20-10)*0.4 = 14
    expect(percentile([10, 20, 30, 40, 50], 10)).toBe(14);
  });
});

describe("average", () => {
  it("returns 0 for empty array", () => {
    expect(average([])).toBe(0);
  });

  it("returns the single value", () => {
    expect(average([7])).toBe(7);
  });

  it("returns correct average for multiple values", () => {
    expect(average([10, 20, 30])).toBe(20);
  });

  it("handles negatives", () => {
    expect(average([-10, 10])).toBe(0);
  });

  it("handles decimals", () => {
    expect(average([1, 2])).toBe(1.5);
  });
});

describe("profitAfterTax", () => {
  it("calculates basic profit with default 5% tax", () => {
    // sell 1000, tax = floor(1000 * 0.05) = 50, profit = 1000 - 50 - 500 = 450
    const result = profitAfterTax(500, 1000);
    expect(result.profit).toBe(450);
    expect(result.profitPercent).toBe(90);
  });

  it("uses custom tax rate", () => {
    // sell 1000, tax = floor(1000 * 0.03) = 30, profit = 1000 - 30 - 500 = 470
    const result = profitAfterTax(500, 1000, 0.03);
    expect(result.profit).toBe(470);
    expect(result.profitPercent).toBe(94);
  });

  it("returns 0% profit when buy price is 0", () => {
    const result = profitAfterTax(0, 1000);
    expect(result.profitPercent).toBe(0);
  });

  it("handles negative profit scenario", () => {
    // sell 100, tax = floor(100 * 0.05) = 5, profit = 100 - 5 - 200 = -105
    const result = profitAfterTax(200, 100);
    expect(result.profit).toBe(-105);
    expect(result.profitPercent).toBe(-52.5);
  });

  it("floors the tax amount", () => {
    // sell 999, tax = floor(999 * 0.05) = floor(49.95) = 49
    const result = profitAfterTax(0, 999);
    expect(result.profit).toBe(950); // 999 - 49
  });
});

describe("chunk", () => {
  it("returns empty array for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("splits evenly", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("handles remainder chunk", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns single chunk when size >= array length", () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it("handles chunk size of 1", () => {
    expect(chunk([1, 2, 3], 1)).toEqual([[1], [2], [3]]);
  });

  it("works with non-number types", () => {
    expect(chunk(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });
});
