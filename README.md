# FFXIV Market Board — 陸行鳥 Datacenter

Local CLI tool for tracking FFXIV market board prices, analytics, and cross-world arbitrage detection for the Taiwan datacenter (陸行鳥). Uses SQLite for storage and optionally serves a Hono REST API.

## Architecture

```
  Universalis API ◄──── CLI: fetch ────► Processors
        │                                    │
        ▼                                    ▼
  Fetch prices / aggregated data        SQLite Database
                                          │       │
  XIVAPI ◄──── CLI: sync-items           ▼       ▼
        │                           CLI: serve  CLI: dump
        ▼                                │       │
  Item metadata ──► SQLite               ▼       ▼
                                  Hono API    Static JSON
                                  /api/v1/*   (GitHub Pages)
```

The CLI (`tsx src/cli.ts <command>`) orchestrates all operations:

| Command       | Purpose                                      |
|---------------|----------------------------------------------|
| `init`        | Create/migrate the SQLite database            |
| `fetch`       | Fetch prices for all tiered items (full manual refresh) |
| `update`      | Cron-friendly: fetch only tiers whose interval has elapsed |
| `sync-items`  | Sync item metadata from XIVAPI               |
| `aggregate`   | Run hourly aggregation rollup                 |
| `maintain`    | Daily cleanup + tier reclassification         |
| `stats`       | Print database statistics                     |
| `serve`       | Start local HTTP API server (default port 3000)|
| `dump`        | Export DB to static JSON files for GitHub Pages |

### Data Processing

- **fetch-prices** — Fetches full listing data per item, stores listings + snapshots + sales in SQLite
- **fetch-aggregated** — Fetches aggregated min/avg/velocity data, stores snapshots in SQLite
- Both processors determine the **cheapest world** by comparing NQ and HQ min prices across all worlds

## Tech Stack

- **Runtime**: Node.js with [tsx](https://github.com/privatenumber/tsx)
- **CLI**: [Commander](https://github.com/tj/commander.js)
- **Framework**: [Hono](https://hono.dev) v4 on `@hono/node-server`
- **Database**: SQLite via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- **Validation**: [Zod](https://zod.dev) v4
- **Language**: TypeScript (strict mode)
- **Testing**: [Vitest](https://vitest.dev)

## API Endpoints

All endpoints are under `/api/v1`.

### Items
| Method | Path                  | Description              |
|--------|-----------------------|--------------------------|
| GET    | `/items`              | List tracked items       |
| GET    | `/items/:itemId`      | Get item details         |

### Prices
| Method | Path                              | Description                    |
|--------|-----------------------------------|--------------------------------|
| GET    | `/prices/:itemId`                 | Current listings (all worlds)  |
| GET    | `/prices/:itemId/world/:worldName`| Listings for a specific world  |
| GET    | `/prices/:itemId/history`         | Price history over time        |
| GET    | `/prices/:itemId/sales`           | Recent sale records            |

### Analytics
| Method | Path           | Description                          |
|--------|----------------|--------------------------------------|
| GET    | `/arbitrage`   | Cross-world arbitrage opportunities  |
| GET    | `/deals`       | Best deals right now                 |
| GET    | `/trending`    | Trending items by volume/price       |
| GET    | `/velocity`    | Item sell-through velocity           |

### Info
| Method | Path          | Description                 |
|--------|---------------|-----------------------------|
| GET    | `/worlds`     | Worlds in 陸行鳥 datacenter |
| GET    | `/tax-rates`  | City tax rates per world    |
| GET    | `/status`     | Health check                |
| GET    | `/stats`      | Data collection statistics  |

## Setup

### Prerequisites

- Node.js 20+

### 1. Install dependencies

```bash
npm install
```

### 2. Initialize the database

```bash
tsx src/cli.ts init
```

### 3. Sync item metadata

```bash
tsx src/cli.ts sync-items
```

### 4. Fetch prices

```bash
# Full manual refresh (all tiers)
tsx src/cli.ts fetch

# Or use the cron-friendly update (only fetches due tiers)
tsx src/cli.ts update
```

### 5. (Optional) Set up cron for automatic updates

```bash
# Run every 5 minutes — only fetches tiers whose interval has elapsed
*/5 * * * * cd /path/to/ff14.tw-marketboard-api && tsx src/cli.ts update >> ./data/update.log 2>&1
```

Tier polling frequencies:
| Tier | Frequency | Items |
|------|-----------|-------|
| 1 | 5 min | High-velocity (>10 sales/day) |
| 2 | 30 min | Medium-velocity (2-10 sales/day) |
| 3 | 60 min | Low-velocity (<2 sales/day) |

The `update` command uses a lock file to prevent overlapping runs, auto-runs daily maintenance, and warns if item metadata sync is stale.

### 6. (Optional) Start the API server

```bash
tsx src/cli.ts serve
```

### 7. (Optional) Export static JSON for GitHub Pages

The `dump` command reads the SQLite database and writes pre-built JSON files that mirror the API route structure. These can be served directly from GitHub Pages as a zero-cost "static API."

```bash
# Export tier 1 items (recommended for frequent dumps, ~15-40 MB)
tsx src/cli.ts dump --tier 1 --clean --output ./static-api

# Export tiers 1 and 2 (comma-separated)
tsx src/cli.ts dump --tier 1,2 --clean --output ./static-api

# Export all items (larger, ~300 MB)
tsx src/cli.ts dump --clean --output ./static-api

# Useful options
tsx src/cli.ts dump --tier 1,2 --clean --pretty --verbose  # Debug with formatted JSON
tsx src/cli.ts dump --items-only                            # Skip analytics files
tsx src/cli.ts dump --analytics-only                        # Skip per-item data
```

Output structure (`<output>/api/v1/`):

| Path | Content |
|------|---------|
| `manifest.json` | Generation metadata + endpoint directory |
| `worlds.json`, `tax-rates.json`, `status.json`, `stats.json` | Static data |
| `items/index.json`, `items/page/{n}.json` | Item catalog (paginated) |
| `items/{itemId}.json` | Item details + latest price snapshot |
| `prices/{itemId}/index.json` | All current listings |
| `prices/{itemId}/history.json` | 7d hourly price history |
| `prices/{itemId}/sales.json` | Recent sales (max 200) |
| `prices/{itemId}/world/{WorldName}.json` | Per-world listings |
| `arbitrage.json`, `deals.json`, `velocity.json` | Analytics |
| `trending/up.json`, `trending/down.json` | Price trends |

Client usage: `fetch('https://<user>.github.io/<repo>/api/v1/prices/4556/index.json')`

## Development

```bash
# Run tests
npm test

# Type check
npm run typecheck
```

## External APIs

- **[Universalis](https://universalis.app/docs)** — Market board price data (listings, history, sales). Rate limit: 25 req/s sustained, 8 max concurrent.
- **[XIVAPI](https://xivapi.com/docs)** — Item metadata (names, categories, icons). Rate limit: ~20 req/s.

## License

[MIT](./LICENSE)
