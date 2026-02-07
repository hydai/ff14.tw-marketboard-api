# FFXIV Market Board — 陸行鳥 Datacenter

Real-time market board price tracking, analytics, and cross-world arbitrage detection for the FFXIV Taiwan datacenter (陸行鳥). Built as a single Cloudflare Worker using D1, KV, and Queues.

## Architecture

```
  Universalis API ◄──── Cron (*/5 min) ────► Queue (market-data)
        │                                          │
        ▼                                          ▼
  Fetch prices / aggregated data            Queue Consumer
        │                                    ├─ fetch-prices
        ▼                                    ├─ fetch-aggregated
    D1 Database ◄───────────────────────────►└─ compute-analytics
        │
        ▼
    KV Cache ◄──── Read-through ────► Hono API ──► /api/v1/*
```

A single Cloudflare Worker handles three entry points:

| Handler     | Trigger                          | Purpose                                   |
|-------------|----------------------------------|-------------------------------------------|
| `fetch`     | HTTP requests                    | Hono REST API for clients                 |
| `scheduled` | Cron (`*/5m`, `04:00`, `06:00`)  | Dispatch tasks, maintenance, item sync    |
| `queue`     | Queue messages                   | Fetch prices, compute analytics           |

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Framework**: [Hono](https://hono.dev) v4
- **Database**: Cloudflare D1 (SQLite)
- **Cache**: Cloudflare KV (read-first layer)
- **Queue**: Cloudflare Queues (background processing)
- **Validation**: [Zod](https://zod.dev) v4
- **Language**: TypeScript (strict mode)
- **Testing**: Vitest with `@cloudflare/vitest-pool-workers`

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
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- Cloudflare account

### 1. Create resources

```bash
# D1 database
wrangler d1 create marketboard-db

# KV namespace
wrangler kv namespace create KV

# Queue
wrangler queues create market-data
```

### 2. Configure wrangler.toml

Replace the placeholder IDs in `wrangler.toml` with the real IDs output by the commands above:

- `d1_databases.database_id`
- `kv_namespaces.id`

### 3. Install dependencies

```bash
npm install
```

### 4. Run database migrations

```bash
# Local
npm run db:migrate

# Remote (production)
npm run db:migrate:remote
```

## Development

```bash
# Start local dev server
npm run dev

# Run tests
npm test

# Type check
npm run typecheck

# Deploy to Cloudflare
npm run deploy
```

## External APIs

- **[Universalis](https://universalis.app/docs)** — Market board price data (listings, history, sales)
- **[XIVAPI](https://xivapi.com/docs)** — Item metadata (names, categories, icons)

## License

[MIT](./LICENSE)
