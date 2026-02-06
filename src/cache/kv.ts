import { createLogger } from "../utils/logger";

const log = createLogger("kv-cache");

export class KVCache {
  constructor(private kv: KVNamespace) {}

  async getJSON<T>(key: string): Promise<T | null> {
    try {
      return await this.kv.get<T>(key, "json");
    } catch (err) {
      log.warn("KV read failed", { key, error: String(err) });
      return null;
    }
  }

  async putJSON<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.kv.put(key, JSON.stringify(value), { expirationTtl: ttlSeconds });
    } catch (err) {
      log.warn("KV write failed", { key, error: String(err) });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.kv.delete(key);
    } catch (err) {
      log.warn("KV delete failed", { key, error: String(err) });
    }
  }

  // Key builders
  static latestPriceKey(itemId: number): string {
    return `item:${itemId}:latest`;
  }

  static listingsKey(itemId: number): string {
    return `item:${itemId}:listings`;
  }

  static arbitrageKey(): string {
    return "arbitrage:top";
  }

  static dealsKey(): string {
    return "deals:top";
  }

  static marketableItemsKey(): string {
    return "items:marketable";
  }
}
