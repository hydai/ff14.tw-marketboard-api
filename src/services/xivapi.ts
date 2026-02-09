import { XIVAPI_BASE_URL, XIVAPI_BATCH_ROWS } from "../config/constants.js";
import { createLogger } from "../utils/logger.js";
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

      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent": "ff14-tw-marketboard/1.0",
            Accept: "application/json",
          },
        });

        if (!resp.ok) {
          log.error("XIVAPI batch error", { status: resp.status, batchSize: batch.length });
          throw new Error(`XIVAPI batch error: ${resp.status}`);
        }

        const data = (await resp.json()) as XIVAPIBatchResponse;
        results.push(...data.rows);
      } catch (err) {
        log.error("XIVAPI batch fetch failed", { offset: i, error: String(err) });
        throw err;
      }
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
        const resp = await fetch(url, {
          headers: {
            "User-Agent": "ff14-tw-marketboard/1.0",
            Accept: "application/json",
          },
        });

        if (!resp.ok) {
          log.warn("XIVAPI name batch failed", { status: resp.status });
          continue;
        }

        const data = (await resp.json()) as XIVAPINameBatchResponse;
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
