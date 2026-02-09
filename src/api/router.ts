import { Hono } from "hono";
import type Database from "better-sqlite3";
import { corsMiddleware, errorHandler, requestLogger } from "./middleware.js";
import { listItems, getItem } from "./handlers/items.js";
import { getListings, getWorldListings, priceHistory, recentSales } from "./handlers/prices.js";
import { getArbitrage } from "./handlers/arbitrage.js";
import { listDeals } from "./handlers/deals.js";
import { listTrending } from "./handlers/trending.js";
import { healthCheck, listWorlds, listTaxRates } from "./handlers/status.js";
import { listVelocity } from "./handlers/velocity.js";
import { getStats } from "./handlers/stats.js";

type AppEnv = { Variables: { db: Database.Database } };

export function createApp(db: Database.Database) {
  const app = new Hono<AppEnv>();

  // Inject db into context
  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });

  // Reject requests outside /api/v1 immediately
  app.use("*", async (c, next) => {
    if (!c.req.path.startsWith("/api/v1")) {
      return c.text("Not Found", 404);
    }
    await next();
  });

  // Global middleware
  app.use("*", corsMiddleware());
  app.use("*", requestLogger);
  app.use("*", errorHandler);

  const api = new Hono<AppEnv>();

  // Items
  api.get("/items", listItems);
  api.get("/items/:itemId", getItem);

  // Prices
  api.get("/prices/:itemId", getListings);
  api.get("/prices/:itemId/world/:worldName", getWorldListings);
  api.get("/prices/:itemId/history", priceHistory);
  api.get("/prices/:itemId/sales", recentSales);

  // Analytics
  api.get("/arbitrage", getArbitrage);
  api.get("/deals", listDeals);
  api.get("/trending", listTrending);
  api.get("/velocity", listVelocity);

  // Info
  api.get("/worlds", listWorlds);
  api.get("/tax-rates", listTaxRates);
  api.get("/status", healthCheck);
  api.get("/stats", getStats);

  app.route("/api/v1", api);

  return app;
}
