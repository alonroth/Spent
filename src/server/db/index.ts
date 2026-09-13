import "server-only";

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations } from "./migrate";
import { transactionCalendarDate } from "@/lib/calendar-date";

const DB_DIR = process.env.SPENT_DATA_DIR
  ? path.resolve(process.env.SPENT_DATA_DIR)
  : path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "spent.db");

const initializedDatabases = new WeakSet<Database.Database>();

function initializeDatabase(db: Database.Database): void {
  if (initializedDatabases.has(db)) return;

  // The database connection is kept on globalThis during development. Register
  // application SQL functions here as well as for brand-new connections so a
  // hot reload cannot leave an older connection without newly added functions.
  db.function(
    "transaction_calendar_date",
    { deterministic: true },
    (value: unknown) =>
      typeof value === "string" ? transactionCalendarDate(value) : null,
  );
  initializedDatabases.add(db);
}

function createDatabase(): Database.Database {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  initializeDatabase(db);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  runMigrations(db);

  return db;
}

declare global {
  var _db: Database.Database | undefined;
}

export function getDb(): Database.Database {
  if (!globalThis._db) {
    globalThis._db = createDatabase();
  }
  initializeDatabase(globalThis._db);
  return globalThis._db;
}
