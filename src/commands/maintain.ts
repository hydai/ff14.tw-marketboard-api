import { resolve } from "node:path";
import { openDatabase, runMigrations } from "../db/database.js";
import { runMaintenance } from "../cron/maintenance.js";

interface MaintainOptions {
  db: string;
}

export function maintainCommand(opts: MaintainOptions): void {
  const dbPath = resolve(opts.db);
  const db = openDatabase(dbPath);
  const migrationsDir = resolve(import.meta.dirname, "../../migrations");
  runMigrations(db, migrationsDir);

  runMaintenance(db);
  db.close();
}
