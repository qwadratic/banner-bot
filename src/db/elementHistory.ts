import Database from "better-sqlite3";
import path from "node:path";

let db: Database.Database | null = null;

const MAX_HISTORY = 5; // track last N elements per stage

export function initElementHistoryDb(): void {
  const dbPath = path.resolve(process.cwd(), "feedback.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS element_history (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      stage      TEXT NOT NULL,
      main_element TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/** Returns the last N MAIN_ELEMENT values used for a given stage (newest first). */
export function getRecentElements(stage: string, limit = MAX_HISTORY): string[] {
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT main_element FROM element_history
       WHERE stage = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(stage, limit) as { main_element: string }[];
  return rows.map((r) => r.main_element);
}

/** Record a MAIN_ELEMENT choice for a stage. */
export function recordElement(stage: string, mainElement: string): void {
  if (!db) return;
  db.prepare(
    `INSERT INTO element_history (stage, main_element) VALUES (?, ?)`,
  ).run(stage, mainElement);
}
