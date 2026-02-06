import { z } from "zod/v4";
import { UNIVERSALIS_BASE_URL } from "../config/constants";
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
    const ids = itemIds.join(",");
    const url = `${this.baseUrl}/${encodeURIComponent(this.dcName)}/${ids}?listings=20&entries=20`;

    log.info("Fetching multi-item prices", { itemCount: itemIds.length });
    const resp = await this.request(url);
    return resp as UniversalisMultiResponse;
  }

  async fetchAggregated(itemIds: number[]): Promise<UniversalisAggregatedResponse> {
    const ids = itemIds.join(",");
    const url = `${this.baseUrl}/aggregated/${encodeURIComponent(this.dcName)}/${ids}`;

    log.info("Fetching aggregated prices", { itemCount: itemIds.length });
    const resp = await this.request(url);
    return resp as UniversalisAggregatedResponse;
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
