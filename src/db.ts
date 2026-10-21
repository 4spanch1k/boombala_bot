import { DatabaseSync } from "node:sqlite";

export type Stage = "collecting" | "awaiting_confirm" | "confirmed";

export interface Conversation {
  wa_id: string;
  human_mode: number;
  stage: Stage;
  draft: string; // JSON
  lead_id: number | null;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function openDb(path = process.env.DB_PATH ?? "data/bot.db") {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_messages (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS conversations (
      wa_id TEXT PRIMARY KEY,
      human_mode INTEGER NOT NULL DEFAULT 0,
      stage TEXT NOT NULL DEFAULT 'collecting',
      draft TEXT NOT NULL DEFAULT '{}',
      lead_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed_by_client',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  return {
    raw: db,
    /** true, если сообщение новое (ещё не обработано) */
    markProcessed(id: string): boolean {
      const r = db.prepare("INSERT OR IGNORE INTO processed_messages (id) VALUES (?)").run(id);
      return Number(r.changes) > 0;
    },
    getConversation(wa_id: string): Conversation {
      db.prepare("INSERT OR IGNORE INTO conversations (wa_id) VALUES (?)").run(wa_id);
      return db.prepare("SELECT * FROM conversations WHERE wa_id = ?").get(wa_id) as unknown as Conversation;
    },
    updateConversation(wa_id: string, patch: Partial<Omit<Conversation, "wa_id">>) {
      for (const [k, v] of Object.entries(patch)) {
        db.prepare(`UPDATE conversations SET ${k} = ? WHERE wa_id = ?`).run(v as never, wa_id);
      }
    },
    addMessage(wa_id: string, role: "user" | "assistant", content: string) {
      db.prepare("INSERT INTO messages (wa_id, role, content) VALUES (?, ?, ?)").run(wa_id, role, content);
    },
    history(wa_id: string, limit = 20): ChatMessage[] {
      const rows = db
        .prepare("SELECT role, content FROM messages WHERE wa_id = ? ORDER BY id DESC LIMIT ?")
        .all(wa_id, limit) as unknown as ChatMessage[];
      return rows.reverse();
    },
    createLead(wa_id: string, data: unknown): number {
      const r = db.prepare("INSERT INTO leads (wa_id, data) VALUES (?, ?)").run(wa_id, JSON.stringify(data));
      return Number(r.lastInsertRowid);
    },
  };
}

export type Db = ReturnType<typeof openDb>;
