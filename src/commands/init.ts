import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { openDatabase, runMigrations } from "../db/database.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("init");

interface InitOptions {
  db: string;
}

export function initCommand(opts: InitOptions): void {
  const dbPath = resolve(opts.db);

  // Ensure parent directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = openDatabase(dbPath);

  const migrationsDir = resolve(import.meta.dirname, "../../migrations");
  runMigrations(db, migrationsDir);

  db.close();
  log.info("Database initialized", { path: dbPath });
}
