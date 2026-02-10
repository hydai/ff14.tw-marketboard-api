import { resolve } from "node:path";
import { openDatabase, runMigrations } from "../db/database.js";
import { runStaticExport } from "../processors/static-export.js";

interface DumpOptions {
  db: string;
  output: string;
  tier?: string;
  historyPeriod: string;
  salesDays: string;
  analyticsLimit: string;
  itemsOnly: boolean;
  analyticsOnly: boolean;
  clean: boolean;
  pretty: boolean;
  verbose: boolean;
}

export function dumpCommand(opts: DumpOptions): void {
  const dbPath = resolve(opts.db);
  const db = openDatabase(dbPath);
  const migrationsDir = resolve(import.meta.dirname, "../../migrations");
  runMigrations(db, migrationsDir);

  const tier = opts.tier ? Number(opts.tier) : undefined;
  if (tier !== undefined && ![1, 2, 3].includes(tier)) {
    console.error("Error: --tier must be 1, 2, or 3");
    db.close();
    process.exit(1);
  }

  runStaticExport({
    db,
    outputDir: resolve(opts.output),
    tier,
    historyPeriod: opts.historyPeriod,
    salesDays: Number(opts.salesDays),
    analyticsLimit: Number(opts.analyticsLimit),
    itemsOnly: opts.itemsOnly ?? false,
    analyticsOnly: opts.analyticsOnly ?? false,
    clean: opts.clean ?? false,
    pretty: opts.pretty ?? false,
    verbose: opts.verbose ?? false,
  });

  db.close();
}
