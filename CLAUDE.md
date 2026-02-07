# CLAUDE.md — FFXIV Market Board

## Project Overview

Cloudflare Worker that tracks FFXIV market board prices for the Taiwan datacenter (陸行鳥). Single worker with three handlers: HTTP API (Hono), cron scheduler, and queue consumer.

## Key Commands

```bash
npm run dev           # Start local dev server (wrangler dev)
npm test              # Run tests (vitest)
npm run typecheck     # Type check (tsc --noEmit)
npm run deploy        # Deploy to Cloudflare
npm run db:migrate    # Run D1 migrations locally
npm run db:migrate:remote  # Run D1 migrations on production
```

## Architecture

Single Cloudflare Worker, three entry points in `src/index.ts`:

- **fetch** — Hono REST API, routes defined in `src/api/router.ts`
- **scheduled** — Cron triggers: price dispatch (*/5 min), maintenance (04:00 UTC), item sync (06:00 UTC)
- **queue** — Processes `market-data` queue messages (fetch-prices, fetch-aggregated, compute-analytics)

### Data Flow

1. Cron dispatches queue messages every 5 minutes
2. Queue consumers fetch data from Universalis API and store in D1
3. Analytics (arbitrage, deals, trending, velocity) are computed as queue jobs
4. API reads from KV cache first, falls back to D1

## Coding Conventions

- **Strict TypeScript** — `strict: true` + `noUncheckedIndexedAccess: true`
- **D1 raw SQL** — No ORM; queries in `src/db/queries.ts`, batch operations in `src/db/batch.ts`
- **KV-first reads** — All API reads go through KV cache (`src/cache/kv.ts`) before D1
- **Hono patterns** — Route handlers are thin; business logic lives in services/db modules
- **Zod v4** — Used for request validation in API handlers
- **No classes** — Functional style; plain functions + interfaces

## File Structure

```
src/
├── index.ts                  # Worker entry (fetch/scheduled/queue)
├── env.ts                    # Env interface + QueueMessage types
├── api/
│   ├── router.ts             # Hono route definitions
│   ├── middleware.ts          # CORS, error handler, request logger
│   └── handlers/             # Route handler functions
├── cache/
│   └── kv.ts                 # KV read-through cache layer
├── config/
│   ├── constants.ts          # Tier config, TTLs, limits
│   └── datacenters.ts        # 陸行鳥 worlds + tax rates
├── cron/
│   ├── dispatcher.ts         # Queue message dispatch logic
│   ├── item-sync.ts          # XIVAPI item metadata sync
│   └── maintenance.ts        # Daily rollup + cleanup
├── db/
│   ├── queries.ts            # D1 SQL queries
│   ├── batch.ts              # Batch insert/upsert helpers
│   └── stats.ts              # Batched D1 count queries for /stats
├── queue/
│   ├── consumer.ts           # Queue message router
│   ├── messages.ts           # Message builder helpers
│   └── processors/           # Per-message-type processors
├── services/
│   ├── universalis.ts        # Universalis API client
│   └── xivapi.ts             # XIVAPI client
└── utils/
    ├── logger.ts             # Structured logger
    ├── math.ts               # Statistics helpers (median, stddev)
    └── types.ts              # Shared type definitions
```

## External APIs

- **Universalis** (https://universalis.app) — Market listings, history, sales. Rate limit: 8 concurrent connections.
- **XIVAPI** (https://xivapi.com) — Item metadata (name, category, icon).

## Critical Patterns

### Cheapest World Resolution

Both queue processors (`fetch-prices`, `fetch-aggregated`) determine the cheapest world by comparing NQ and HQ min prices — null prices are treated as `Infinity` so they never win. The overall cheapest is written to both D1 (`cheapest_world_id`, `cheapest_world_name`) and KV (`cheapestWorld`).

- `fetch-prices` has full listing data, so it reads `worldName` directly from the `UniversalisListing` object
- `fetch-aggregated` only gets a numeric `worldId` from the aggregated endpoint, so it resolves the name via `WORLDS_BY_ID` from `src/config/datacenters.ts`

### KV vs D1 Response Format

KV cache stores camelCase (`PriceSummary`), D1 returns snake_case. The frontend uses `normalizePriceSummary()` to unify both formats. API reads go KV-first, falling back to D1.

## Important Notes

- Queue concurrency is capped at 6 (`wrangler.toml`) to stay under Universalis's 8 connection limit
- Items are tiered (1/2/3) for fetch priority — tier 1 items are fetched most frequently
- D1 migrations live in `migrations/`; apply with `npm run db:migrate`
- Placeholder IDs in `wrangler.toml` must be replaced with real resource IDs before deploying
