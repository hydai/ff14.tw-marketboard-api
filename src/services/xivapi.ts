import { XIVAPI_BASE_URL } from "../config/constants";
import { createLogger } from "../utils/logger";
import type { XIVAPIItem } from "../utils/types";

const log = createLogger("xivapi");

export class XIVAPIClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = XIVAPI_BASE_URL;
  }

  async fetchItem(itemId: number): Promise<XIVAPIItem | null> {
    const url = `${this.baseUrl}/sheet/Item/${itemId}?fields=Name,Name@ja,Name@zh,Icon,ItemSearchCategory.Name,CanBeHq,StackSize`;

    try {
      const resp = await fetch(url, {
        headers: {
          "User-Agent": "ff14-tw-marketboard/1.0",
          Accept: "application/json",
        },
      });

      if (resp.status === 404) return null;
      if (!resp.ok) {
        log.error("XIVAPI error", { status: resp.status, itemId });
        throw new Error(`XIVAPI error: ${resp.status}`);
      }

      return (await resp.json()) as XIVAPIItem;
    } catch (err) {
      log.error("XIVAPI fetch failed", { itemId, error: String(err) });
      throw err;
    }
  }

  async fetchItemsBatch(itemIds: number[]): Promise<XIVAPIItem[]> {
    // XIVAPI v2 doesn't have a true batch endpoint for arbitrary IDs,
    // so we use the search/sheet endpoint with pagination
    const results: XIVAPIItem[] = [];

    // Process in parallel with concurrency limit
    const CONCURRENCY = 10;
    for (let i = 0; i < itemIds.length; i += CONCURRENCY) {
      const batch = itemIds.slice(i, i + CONCURRENCY);
      const promises = batch.map((id) => this.fetchItem(id));
      const items = await Promise.allSettled(promises);

      for (const result of items) {
        if (result.status === "fulfilled" && result.value) {
          results.push(result.value);
        }
      }
    }

    return results;
  }
}
