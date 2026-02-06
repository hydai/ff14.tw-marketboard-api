import { Context } from "hono";
import type { Env } from "../../env";
import { DC_LUHANGNIAO } from "../../config/datacenters";
import { getMeta, getTaxRates } from "../../db/queries";

export async function healthCheck(c: Context<{ Bindings: Env }>) {
  const [lastPoll, taxRatesResult] = await Promise.all([
    getMeta(c.env.DB, "last_poll_time"),
    getTaxRates(c.env.DB),
  ]);

  return c.json({
    status: "ok",
    datacenter: DC_LUHANGNIAO.name,
    worlds: DC_LUHANGNIAO.worlds.length,
    lastPollTime: lastPoll?.value ?? null,
    taxRateCount: taxRatesResult.results.length,
  });
}

export async function listWorlds(c: Context<{ Bindings: Env }>) {
  return c.json({
    data: DC_LUHANGNIAO.worlds.map((w) => ({
      id: w.id,
      name: w.name,
      nameEn: w.nameEn,
    })),
    datacenter: DC_LUHANGNIAO.name,
  });
}

export async function listTaxRates(c: Context<{ Bindings: Env }>) {
  const result = await getTaxRates(c.env.DB);
  return c.json({ data: result.results });
}
