#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { fetchCommand } from "./commands/fetch.js";
import { syncCommand } from "./commands/sync.js";
import { aggregateCommand } from "./commands/aggregate.js";
import { maintainCommand } from "./commands/maintain.js";
import { statsCommand } from "./commands/stats.js";
import { serveCommand } from "./commands/serve.js";
import { updateCommand } from "./commands/update.js";
import { dumpCommand } from "./commands/dump.js";

const program = new Command();

program
  .name("ff14-marketboard")
  .description("FFXIV Market Board price tracker for 陸行鳥 datacenter")
  .version("2.0.0");

program
  .command("init")
  .description("Create/migrate the SQLite database")
  .option("--db <path>", "SQLite file path", "./data/marketboard.db")
  .action(initCommand);

program
  .command("fetch")
  .description("Fetch prices for all tiered items (full hourly cycle)")
  .option("--db <path>", "SQLite file path", "./data/marketboard.db")
  .option("--tier <tier>", "Only fetch a specific tier (1, 2, or 3)")
  .option("--concurrency <n>", "Max concurrent HTTP requests (max 8)", "8")
  .option("--verbose", "Debug logging")
  .action(fetchCommand);

program
  .command("sync-items")
  .description("Sync item metadata from XIVAPI")
  .option("--db <path>", "SQLite file path", "./data/marketboard.db")
  .option("--verbose", "Debug logging")
  .action(syncCommand);

program
  .command("aggregate")
  .description("Run hourly aggregation rollup")
  .option("--db <path>", "SQLite file path", "./data/marketboard.db")
  .action(aggregateCommand);

program
  .command("maintain")
  .description("Run daily maintenance (cleanup + tier reclassification)")
  .option("--db <path>", "SQLite file path", "./data/marketboard.db")
  .action(maintainCommand);

program
  .command("stats")
  .description("Print database statistics")
  .option("--db <path>", "SQLite file path", "./data/marketboard.db")
  .action(statsCommand);

program
  .command("serve")
  .description("Start local HTTP API server")
  .option("--db <path>", "SQLite file path", "./data/marketboard.db")
  .option("--port <port>", "Port to listen on", "3000")
  .action(serveCommand);

program
  .command("update")
  .description("Cron-friendly update: fetch only tiers whose polling interval has elapsed")
  .option("--db <path>", "SQLite file path", "./data/marketboard.db")
  .option("--concurrency <n>", "Max concurrent HTTP requests (max 8)", "8")
  .option("--daemon", "Run continuously in a loop instead of exiting after one cycle")
  .option("--interval <minutes>", "Minutes between cycles in daemon mode (min 1)", "5")
  .option("--verbose", "Debug logging")
  .action(updateCommand);

program
  .command("dump")
  .description("Export database to static JSON files for GitHub Pages hosting")
  .option("--db <path>", "SQLite file path", "./data/marketboard.db")
  .option("--output <dir>", "Output directory", "./static-api")
  .option("--tier <tier>", "Only export items in this tier (1, 2, or 3)")
  .option("--history-period <period>", "Price history window", "7d")
  .option("--sales-days <days>", "Sales history window in days", "7")
  .option("--analytics-limit <n>", "Max rows per analytics file", "200")
  .option("--items-only", "Skip analytics endpoints")
  .option("--analytics-only", "Skip per-item data")
  .option("--clean", "Remove output dir before export")
  .option("--pretty", "Pretty-print JSON (larger files)")
  .option("--verbose", "Debug logging")
  .action(dumpCommand);

program.parse();
