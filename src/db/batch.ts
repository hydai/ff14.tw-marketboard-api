import type Database from "better-sqlite3";
import { createLogger } from "../utils/logger.js";

const log = createLogger("db-batch");

export function batchInsert(
  db: Database.Database,
  table: string,
  columns: string[],
  rows: unknown[][],
  onConflict?: string
): void {
  if (rows.length === 0) return;

  const placeholders = columns.map(() => "?").join(", ");
  const conflict = onConflict ? ` ${onConflict}` : "";
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})${conflict}`;

  const stmt = db.prepare(sql);

  const insertAll = db.transaction((rows: unknown[][]) => {
    for (const row of rows) {
      stmt.run(...row);
    }
  });

  try {
    insertAll(rows);
  } catch (err) {
    log.error("Batch insert failed", {
      table,
      rowCount: rows.length,
      error: String(err),
    });
    throw err;
  }
}

export function batchDelete(
  db: Database.Database,
  table: string,
  whereColumn: string,
  values: (string | number)[]
): void {
  if (values.length === 0) return;

  const deleteAll = db.transaction((vals: (string | number)[]) => {
    // Use chunks to keep placeholder count reasonable
    const chunkSize = 500;
    for (let i = 0; i < vals.length; i += chunkSize) {
      const batch = vals.slice(i, i + chunkSize);
      const placeholders = batch.map(() => "?").join(", ");
      const sql = `DELETE FROM ${table} WHERE ${whereColumn} IN (${placeholders})`;
      db.prepare(sql).run(...batch);
    }
  });

  try {
    deleteAll(values);
  } catch (err) {
    log.error("Batch delete failed", { table, error: String(err) });
    throw err;
  }
}
