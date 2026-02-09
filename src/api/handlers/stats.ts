import { Context } from "hono";
import type Database from "better-sqlite3";
import { DC_LUHANGNIAO } from "../../config/datacenters.js";
import { getMeta } from "../../db/queries.js";
import { getCollectionStats } from "../../db/stats.js";

type AppEnv = { Variables: { db: Database.Database } };

export function getStats(c: Context<AppEnv>) {
  const db = c.get("db");

  const stats = getCollectionStats(db);
  const lastPoll = getMeta(db, "last_poll_time");
  const lastMaintenance = getMeta(db, "last_maintenance");
  const lastItemSync = getMeta(db, "last_item_sync");

  return c.json({
    datacenter: DC_LUHANGNIAO.name,
    generatedAt: new Date().toISOString(),
    system: {
      lastPollTime: lastPoll?.value ?? null,
      lastMaintenance: lastMaintenance?.value ?? null,
      lastItemSync: lastItemSync?.value ?? null,
    },
    tables: stats.tables,
    tiers: stats.tiers,
    freshness: stats.freshness,
  });
}
