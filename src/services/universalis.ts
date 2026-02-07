import { z } from "zod/v4";
import {
  UNIVERSALIS_BASE_URL,
  UNIVERSALIS_ITEMS_PER_REQUEST,
  UNIVERSALIS_ITEMS_PER_REQUEST_AGGREGATED,
} from "../config/constants";
import { chunk } from "../utils/math";
import { DC_LUHANGNIAO } from "../config/datacenters";
import { createLogger } from "../utils/logger";
import type {
  UniversalisMultiResponse,
  UniversalisAggregatedResponse,
  UniversalisTaxRates,
} from "../utils/types";

const log = createLogger("universalis");

const RateLimitError = z.object({
  message: z.string(),
  retryAfter: z.number().optional(),
});

export class UniversalisClient {
  private baseUrl: string;
  private dcName: string;

  constructor(dcName?: string) {
    this.baseUrl = UNIVERSALIS_BASE_URL;
    this.dcName = dcName ?? DC_LUHANGNIAO.name;
  }

  async fetchMultiItemPrices(itemIds: number[]): Promise<UniversalisMultiResponse> {
    const batches = chunk(itemIds, UNIVERSALIS_ITEMS_PER_REQUEST);
    log.info("Fetching multi-item prices", {
      itemCount: itemIds.length,
      batches: batches.length,
    });

    const merged: UniversalisMultiResponse = { itemIDs: [], items: {}, dcName: this.dcName };

    for (const batch of batches) {
      const ids = batch.join(",");
      const url = `${this.baseUrl}/${encodeURIComponent(this.dcName)}/${ids}?listings=20&entries=20`;
      const resp = (await this.request(url)) as UniversalisMultiResponse;
      merged.itemIDs.push(...resp.itemIDs);
      Object.assign(merged.items, resp.items);
    }

    return merged;
  }

  async fetchAggregated(itemIds: number[]): Promise<UniversalisAggregatedResponse> {
    const batches = chunk(itemIds, UNIVERSALIS_ITEMS_PER_REQUEST_AGGREGATED);
    log.info("Fetching aggregated prices", {
      itemCount: itemIds.length,
      batches: batches.length,
    });

    const merged: UniversalisAggregatedResponse = { results: [], failedItems: [] };

    for (const batch of batches) {
      const ids = batch.join(",");
      const url = `${this.baseUrl}/aggregated/${encodeURIComponent(this.dcName)}/${ids}`;
      const resp = (await this.request(url)) as UniversalisAggregatedResponse;
      merged.results.push(...resp.results);
      merged.failedItems.push(...resp.failedItems);
    }

    return merged;
  }

  async fetchMarketableItems(): Promise<number[]> {
    const url = `${this.baseUrl}/marketable`;
    log.info("Fetching marketable item list");
    const resp = await this.request(url);
    return resp as number[];
  }

  async fetchTaxRates(worldId: number): Promise<UniversalisTaxRates> {
    const url = `${this.baseUrl}/tax-rates?world=${worldId}`;
    log.info("Fetching tax rates", { worldId });
    const resp = await this.request(url);
    return resp as UniversalisTaxRates;
  }

  private async request(url: string): Promise<unknown> {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": "ff14-tw-marketboard/1.0 (Cloudflare Worker)",
        Accept: "application/json",
      },
    });

    if (resp.status === 429) {
      const body = await resp.json().catch(() => ({}));
      const parsed = RateLimitError.safeParse(body);
      const retryAfter = parsed.success ? parsed.data.retryAfter ?? 5 : 5;
      log.warn("Rate limited by Universalis", { retryAfter, url });
      throw new RateLimitedError(retryAfter);
    }

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      log.error("Universalis API error", {
        status: resp.status,
        url,
        body: text.slice(0, 200),
      });
      throw new Error(`Universalis API error: ${resp.status}`);
    }

    return resp.json();
  }
}

export class RateLimitedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limited. Retry after ${retryAfterSeconds}s`);
    this.name = "RateLimitedError";
  }
}
