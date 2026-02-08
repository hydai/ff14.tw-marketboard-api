import { Hono } from "hono";
import type { Env } from "../env";
import { corsMiddleware, errorHandler, requestLogger } from "./middleware";
import { listItems, getItem } from "./handlers/items";
import { getListings, getWorldListings, priceHistory, recentSales } from "./handlers/prices";
import { getArbitrage } from "./handlers/arbitrage";
import { listDeals } from "./handlers/deals";
import { listTrending } from "./handlers/trending";
import { healthCheck, listWorlds, listTaxRates } from "./handlers/status";
import { listVelocity } from "./handlers/velocity";
import { getStats } from "./handlers/stats";

const app = new Hono<{ Bindings: Env }>();

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

const api = new Hono<{ Bindings: Env }>();

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

export { app };
