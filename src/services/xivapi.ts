import { XIVAPI_BASE_URL, XIVAPI_BATCH_ROWS } from "../config/constants.js";
import { createLogger } from "../utils/logger.js";
import { retryWithBackoff } from "../utils/rate-limiter.js";
import type { XIVAPIItem } from "../utils/types.js";

const log = createLogger("xivapi");

interface XIVAPIBatchResponse {
  rows: XIVAPIItem[];
}

interface XIVAPINameRow {
  row_id: number;
  fields: { Name: string };
}

interface XIVAPINameBatchResponse {
  rows: XIVAPINameRow[];
}

export class XIVAPIClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = XIVAPI_BASE_URL;
  }

  private async request<T>(url: string): Promise<T> {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "ff14-tw-marketboard/1.0",
        Accept: "application/json",
      },
    });

    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get("retry-after") ?? "", 10) || 5;
      log.warn("Rate limited by XIVAPI", { retryAfter, url });
      throw new Error(`XIVAPI rate limited. Retry after ${retryAfter}s`);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      log.error("XIVAPI API error", { status: resp.status, url, body: text.slice(0, 200) });
      throw new Error(`XIVAPI API error: ${resp.status}`);
    }

    return resp.json() as Promise<T>;
  }

  async fetchItemsBatchV2(
    itemIds: number[],
    language?: string
  ): Promise<XIVAPIItem[]> {
    const results: XIVAPIItem[] = [];

    for (let i = 0; i < itemIds.length; i += XIVAPI_BATCH_ROWS) {
      const batch = itemIds.slice(i, i + XIVAPI_BATCH_ROWS);
      const rowsParam = batch.join(",");
      const langParam = language ? `&language=${language}` : "";
      const url = `${this.baseUrl}/sheet/Item?fields=Name,Icon,ItemSearchCategory.Name,CanBeHq,StackSize&rows=${rowsParam}${langParam}`;

      const data = await retryWithBackoff(
        () => this.request<XIVAPIBatchResponse>(url),
        { maxRetries: 3, baseDelayMs: 1000 },
      );
      results.push(...data.rows);
    }

    return results;
  }

  async fetchItemNamesBatchV2(
    itemIds: number[],
    language: string
  ): Promise<Map<number, string>> {
    const nameMap = new Map<number, string>();

    for (let i = 0; i < itemIds.length; i += XIVAPI_BATCH_ROWS) {
      const batch = itemIds.slice(i, i + XIVAPI_BATCH_ROWS);
      const rowsParam = batch.join(",");
      const url = `${this.baseUrl}/sheet/Item?fields=Name&language=${language}&rows=${rowsParam}`;

      try {
        const data = await retryWithBackoff(
          () => this.request<XIVAPINameBatchResponse>(url),
          { maxRetries: 3, baseDelayMs: 1000 },
        );
        for (const row of data.rows) {
          nameMap.set(row.row_id, row.fields.Name);
        }
      } catch (err) {
        log.warn("XIVAPI name batch fetch failed", { offset: i, error: String(err) });
      }
    }

    return nameMap;
  }
}
