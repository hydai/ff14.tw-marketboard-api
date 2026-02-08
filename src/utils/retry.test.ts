import { describe, it, expect, vi } from "vitest";
import { isTransientD1Error, withD1Retry } from "./retry";

describe("isTransientD1Error", () => {
  it("detects 'Network connection lost'", () => {
    expect(isTransientD1Error(new Error("D1_ERROR: Network connection lost"))).toBe(true);
  });

  it("detects 'internal error'", () => {
    expect(isTransientD1Error(new Error("D1_ERROR: internal error"))).toBe(true);
  });

  it("detects 'connection reset'", () => {
    expect(isTransientD1Error(new Error("connection reset by peer"))).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isTransientD1Error(new Error("NETWORK CONNECTION LOST"))).toBe(true);
  });

  it("rejects SQL syntax errors", () => {
    expect(isTransientD1Error(new Error("SQLITE_ERROR: near 'SELEC': syntax error"))).toBe(false);
  });

  it("rejects constraint violations", () => {
    expect(isTransientD1Error(new Error("UNIQUE constraint failed: items.item_id"))).toBe(false);
  });

  it("handles non-Error values", () => {
    expect(isTransientD1Error("Network connection lost")).toBe(true);
    expect(isTransientD1Error(42)).toBe(false);
  });
});

describe("withD1Retry", () => {
  it("returns on first success without retry", async () => {
    const fn = vi.fn().mockResolvedValue("ok");

    const result = await withD1Retry(fn);

    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error then succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("D1_ERROR: Network connection lost"))
      .mockResolvedValue("recovered");

    const result = await withD1Retry(fn, { baseDelayMs: 1 });

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on non-transient error", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("SQLITE_ERROR: syntax error"));

    await expect(withD1Retry(fn, { baseDelayMs: 1 })).rejects.toThrow("syntax error");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("throws after max retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("D1_ERROR: Network connection lost"));

    await expect(withD1Retry(fn, { maxAttempts: 3, baseDelayMs: 1 })).rejects.toThrow(
      "Network connection lost"
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("respects custom maxAttempts", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("D1_ERROR: internal error"));

    await expect(withD1Retry(fn, { maxAttempts: 2, baseDelayMs: 1 })).rejects.toThrow(
      "internal error"
    );
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
