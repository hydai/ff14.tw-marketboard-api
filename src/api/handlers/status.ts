import { Context } from "hono";
import type Database from "better-sqlite3";
import { DC_LUHANGNIAO } from "../../config/datacenters.js";
import { getMeta, getTaxRates } from "../../db/queries.js";

type AppEnv = { Variables: { db: Database.Database } };

export function healthCheck(c: Context<AppEnv>) {
  const db = c.get("db");
  const lastPoll = getMeta(db, "last_poll_time");
  const taxRates = getTaxRates(db);

  return c.json({
    status: "ok",
    datacenter: DC_LUHANGNIAO.name,
    worlds: DC_LUHANGNIAO.worlds.length,
    lastPollTime: lastPoll?.value ?? null,
    taxRateCount: taxRates.length,
  });
}

export function listWorlds(c: Context<AppEnv>) {
  return c.json({
    data: DC_LUHANGNIAO.worlds.map((w) => ({
      id: w.id,
      name: w.name,
      nameEn: w.nameEn,
    })),
    datacenter: DC_LUHANGNIAO.name,
  });
}

export function listTaxRates(c: Context<AppEnv>) {
  const db = c.get("db");
  const data = getTaxRates(db);
  return c.json({ data });
}
