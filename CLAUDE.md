# CLAUDE.md — FFXIV Market Board

## Project Overview

Local CLI tool that tracks FFXIV market board prices for the Taiwan datacenter (陸行鳥). Fetches data from Universalis/XIVAPI and stores it in a local SQLite database. Optionally serves a Hono REST API.

## Key Commands

```bash
tsx src/cli.ts init             # Create/migrate the SQLite database
tsx src/cli.ts fetch            # Fetch prices for all tiered items (full manual refresh)
tsx src/cli.ts update           # Cron-friendly: fetch only tiers whose interval has elapsed
tsx src/cli.ts update --daemon  # Run continuously (replaces cron); --interval <min> sets cycle time
tsx src/cli.ts sync-items       # Sync item metadata from XIVAPI
tsx src/cli.ts aggregate        # Run hourly aggregation rollup
tsx src/cli.ts maintain         # Run daily maintenance (cleanup + tier reclassification)
tsx src/cli.ts stats            # Print database statistics
tsx src/cli.ts serve            # Start local HTTP API server (default port 3000)
tsx src/cli.ts dump             # Export DB to static JSON files (for GitHub Pages)
tsx src/cli.ts dump --tier 1 --clean --output ./static-api  # Single tier
tsx src/cli.ts dump --tier 1,2 --clean --output ./static-api  # Multiple tiers (comma-separated)

npm test              # Run tests (vitest)
npm run typecheck     # Type check (tsc --noEmit)
```

## Architecture

Local CLI (`tsx src/cli.ts <command>`) with direct SQLite access via `better-sqlite3`.

- **CLI entry** — `src/cli.ts` uses `commander` to parse subcommands
- **Commands** — `src/commands/*.ts` orchestrate processors and cron logic
- **Processors** — `src/processors/*.ts` fetch data from APIs and write to SQLite
- **API server** — Hono on `@hono/node-server`, started via `serve` command
- **Static export** — `dump` command writes pre-built JSON files mirroring API routes for GitHub Pages hosting

### Data Flow

1. `fetch` runs a full manual refresh; `update` is cron-friendly (only fetches due tiers)
2. Processors fetch data from Universalis API with rate limiting
3. Data stored directly in local SQLite via `better-sqlite3`
4. API reads directly from SQLite (sub-millisecond locally, no cache layer needed)
5. `dump` exports SQLite data to static JSON files matching API route structure

### Tier Polling Frequencies

| Tier | Frequency | Items | Trigger |
|------|-----------|-------|---------|
| 1 | 5 min | High-velocity (>10 sales/day) | Every cron tick |
| 2 | 30 min | Medium-velocity (2-10 sales/day) | Every 6th tick |
| 3 | 60 min | Low-velocity (<2 sales/day) | Every 12th tick |

The `update` command tracks per-tier timestamps (`last_fetch_tier_1/2/3` in `system_meta`) and only fetches tiers whose interval has elapsed. It also auto-runs maintenance (daily) and warns if item sync is stale (>7 days).

## Coding Conventions

- **Strict TypeScript** — `strict: true` + `noUncheckedIndexedAccess: true`
- **NodeNext modules** — All relative imports use `.js` extensions
- **better-sqlite3** — Synchronous API, no ORM; queries in `src/db/queries.ts`
- **No classes for DB** — Functional style; plain functions + interfaces
- **Hono patterns** — Route handlers are thin; business logic lives in db/processors
- **Zod v4** — Used for request validation in API handlers

## File Structure

```
src/
├── cli.ts                    # CLI entry point (commander)
├── commands/                 # CLI command handlers
│   ├── init.ts               # Create/migrate database
│   ├── fetch.ts              # Full manual fetch (all tiers)
│   ├── update.ts             # Cron-friendly tier-aware update
│   ├── sync.ts               # XIVAPI item metadata sync
│   ├── aggregate.ts          # Hourly aggregation rollup
│   ├── maintain.ts           # Daily maintenance
│   ├── stats.ts              # Print DB statistics
│   ├── serve.ts              # Start HTTP API server
│   └── dump.ts               # Static JSON export for GitHub Pages
├── api/
│   ├── router.ts             # Hono route definitions
│   ├── middleware.ts          # CORS, error handler, request logger
│   └── handlers/             # Route handler functions
├── processors/               # Data processing
│   ├── fetch-prices.ts       # Full listing fetch + store
│   ├── fetch-aggregated.ts   # Aggregated price fetch + store
│   ├── tier-fetcher.ts       # Shared per-tier fetch loop (used by fetch + update)
│   ├── compute-analytics.ts  # Analytics computation
│   ├── sync-items.ts         # XIVAPI item sync
│   └── static-export.ts      # Static JSON file generator (used by dump)
├── config/
│   ├── constants.ts          # Tier config, limits
│   └── datacenters.ts        # 陸行鳥 worlds + tax rates
├── cron/
│   ├── aggregation.ts        # Hourly price aggregation rollup
│   └── maintenance.ts        # Daily cleanup + tier reclassification
├── db/
│   ├── database.ts           # better-sqlite3 wrapper + migration runner
│   ├── queries.ts            # SQL queries
│   ├── batch.ts              # Batch insert/delete helpers
│   └── stats.ts              # Count queries for stats
├── services/
│   ├── universalis.ts        # Universalis API client
│   └── xivapi.ts             # XIVAPI client
└── utils/
    ├── logger.ts             # Structured logger
    ├── lock.ts               # PID-based lock file for cron safety
    ├── math.ts               # Statistics helpers (median, stddev)
    ├── rate-limiter.ts       # Concurrency limiter for HTTP requests
    └── types.ts              # Shared type definitions
```

## External APIs

- **Universalis** (https://universalis.app) — Market listings, history, sales. Rate limit: 8 concurrent connections.
- **XIVAPI** (https://xivapi.com) — Item metadata (name, category, icon).

## Critical Patterns

### Cheapest World Resolution

Both processors (`fetch-prices`, `fetch-aggregated`) determine the cheapest world by comparing NQ and HQ min prices — null prices are treated as `Infinity` so they never win.

- `fetch-prices` has full listing data, reads `worldName` directly from `UniversalisListing`
- `fetch-aggregated` only gets numeric `worldId`, resolves name via `WORLDS_BY_ID`

### Listing Dedup (fetch-prices)

Universalis can return duplicate `listing_id`s within a single multi-item response. The INSERT into `current_listings` uses `ON CONFLICT(item_id, world_id, listing_id) DO NOTHING` to handle this — do not remove it even though the preceding DELETE appears to make conflicts impossible. The duplicates come from within the same API batch, not from pre-existing rows.

### Sales Dedup (fetch-prices)

Instead of KV-based `lastSaleTs`, the CLI version queries `SELECT MAX(sold_at) FROM sales_history WHERE item_id = ?` to determine the cutoff for new sales.

## Important Notes

- Rate limiting uses a semaphore-based `RateLimiter` (max 8 concurrent, capped at `UNIVERSALIS_MAX_CONCURRENT`) with `retryWithBackoff` for 429 handling on both Universalis and XIVAPI
- Items are tiered (1/2/3) with different polling frequencies (5/30/60 min)
- The `update` command uses a PID-based lock file (`./data/marketboard.lock`) to prevent overlapping cron runs
- Migrations live in `migrations/`; applied automatically on database open
- SQLite database defaults to `./data/marketboard.db`
