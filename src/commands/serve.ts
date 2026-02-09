import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { openDatabase, runMigrations } from "../db/database.js";
import { createApp } from "../api/router.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("serve-cmd");

interface ServeOptions {
  db: string;
  port: string;
}

export function serveCommand(opts: ServeOptions): void {
  const dbPath = resolve(opts.db);
  const port = parseInt(opts.port, 10) || 3000;

  const db = openDatabase(dbPath);
  const migrationsDir = resolve(import.meta.dirname, "../../migrations");
  runMigrations(db, migrationsDir);

  const app = createApp(db);

  log.info("Starting HTTP server", { port, db: dbPath });
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);

  serve({ fetch: app.fetch, port });
}
