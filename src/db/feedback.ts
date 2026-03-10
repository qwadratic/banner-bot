import Database from "better-sqlite3";
import path from "node:path";

let db: Database.Database | null = null;

export function initFeedbackDb(): void {
  const dbPath = path.resolve(process.cwd(), "feedback.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS feedback (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL,
      session_id   TEXT NOT NULL,
      input_text   TEXT,
      stage        TEXT,
      modules      TEXT,
      image_prompt TEXT,
      generation_n INTEGER,
      rating       INTEGER,
      comment      TEXT,
      created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

export function insertFeedback(params: {
  userId: number;
  sessionId: string;
  inputText: string;
  stage: string | null;
  modules: string | null;
  imagePrompt: string | null;
  generationN: number;
  rating: number;
  comment: string | null;
}): void {
  if (!db) throw new Error("Feedback DB not initialized");
  const stmt = db.prepare(`
    INSERT INTO feedback (user_id, session_id, input_text, stage, modules, image_prompt, generation_n, rating, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    params.userId,
    params.sessionId,
    params.inputText,
    params.stage,
    params.modules,
    params.imagePrompt,
    params.generationN,
    params.rating,
    params.comment,
  );
}
