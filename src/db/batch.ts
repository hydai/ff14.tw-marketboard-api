import { createLogger } from "../utils/logger";

const log = createLogger("db-batch");

// D1 has a limit of 100 bound parameters per statement.
// For batch inserts, we chunk rows to stay under this limit.
const D1_MAX_PARAMS = 100;

export async function batchInsert(
  db: D1Database,
  table: string,
  columns: string[],
  rows: unknown[][],
  onConflict?: string
): Promise<void> {
  if (rows.length === 0) return;

  const paramsPerRow = columns.length;
  const maxRowsPerBatch = Math.floor(D1_MAX_PARAMS / paramsPerRow);

  for (let i = 0; i < rows.length; i += maxRowsPerBatch) {
    const batch = rows.slice(i, i + maxRowsPerBatch);
    const placeholders = batch
      .map((_, idx) => {
        const offset = idx * paramsPerRow;
        const params = columns.map((_, j) => `?${offset + j + 1}`).join(", ");
        return `(${params})`;
      })
      .join(", ");

    const conflict = onConflict ? ` ${onConflict}` : "";
    const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}${conflict}`;
    const bindings = batch.flat();

    try {
      await db
        .prepare(sql)
        .bind(...bindings)
        .run();
    } catch (err) {
      log.error("Batch insert failed", {
        table,
        batchSize: batch.length,
        error: String(err),
      });
      throw err;
    }
  }
}

export async function batchDelete(
  db: D1Database,
  table: string,
  whereColumn: string,
  values: (string | number)[]
): Promise<void> {
  if (values.length === 0) return;

  // D1 max params = 100
  for (let i = 0; i < values.length; i += D1_MAX_PARAMS) {
    const batch = values.slice(i, i + D1_MAX_PARAMS);
    const placeholders = batch.map(() => "?").join(", ");
    const sql = `DELETE FROM ${table} WHERE ${whereColumn} IN (${placeholders})`;

    try {
      await db
        .prepare(sql)
        .bind(...batch)
        .run();
    } catch (err) {
      log.error("Batch delete failed", { table, error: String(err) });
      throw err;
    }
  }
}
