import { resolve } from "node:path";
import { openDatabase, runMigrations } from "../db/database.js";
import { runAggregation } from "../cron/aggregation.js";

interface AggregateOptions {
  db: string;
}

export function aggregateCommand(opts: AggregateOptions): void {
  const dbPath = resolve(opts.db);
  const db = openDatabase(dbPath);
  const migrationsDir = resolve(import.meta.dirname, "../../migrations");
  runMigrations(db, migrationsDir);

  runAggregation(db);
  db.close();
}
