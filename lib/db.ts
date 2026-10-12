import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { MIGRATIONS } from "./schema";

export const DB_PATH = process.env.INSIGHT_DB_PATH ?? path.join(process.cwd(), "data", "insight.db");

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
const g = globalThis as unknown as { __insightDb?: Database.Database };
export function db(): Database.Database {
  if (!g.__insightDb) g.__insightDb = openDb();
  return g.__insightDb;
}
