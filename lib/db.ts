import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema";

/**
 * The default database file, data/prism.db. An existing data/insight.db (with its -wal and
 * -shm files) is renamed once, the first time the app starts after the rename. If another
 * process still has it open, the old name is used until the next start.
 */
export function resolveDbPath(dataDir: string = path.join(process.cwd(), "data")): string {
  const file = path.join(dataDir, "prism.db");
  // Before the rename to Prism the database was data/insight.db.
  const legacy = path.join(dataDir, "insight.db");
  if (fs.existsSync(file) || !fs.existsSync(legacy)) return file;
  try {
    // The -wal file holds committed changes, so it moves with the database (and before it).
    for (const ext of ["-wal", "-shm"]) if (fs.existsSync(legacy + ext)) fs.renameSync(legacy + ext, file + ext);
    fs.renameSync(legacy, file);
    return file;
  } catch {
    // Put back anything already moved, so the old database stays whole.
    for (const ext of ["-wal", "-shm"]) if (fs.existsSync(file + ext) && !fs.existsSync(file)) fs.renameSync(file + ext, legacy + ext);
    return legacy;
  }
}

export const DB_PATH = process.env.PRISM_DB_PATH ?? process.env.INSIGHT_DB_PATH ?? resolveDbPath();

export function openDb(file: string = DB_PATH): Database.Database {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.pragma("busy_timeout = 5000");
  migrate(conn);
  return conn;
}

export function migrate(conn: Database.Database): void {
  const current = conn.pragma("user_version", { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    conn.transaction(() => {
      conn.exec(MIGRATIONS[v]!);
      conn.pragma(`user_version = ${v + 1}`);
    })();
  }
}

// One shared connection, reused across dev hot reloads.
const g = globalThis as unknown as { __prismDb?: Database.Database };
export function db(): Database.Database {
  if (!g.__prismDb) g.__prismDb = openDb();
  return g.__prismDb;
}
