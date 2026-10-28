import { DatabaseSync } from "node:sqlite";

export type Stage = "collecting" | "awaiting_confirm" | "awaiting_payment" | "confirmed" | "paid";

export interface Booking {
  id: number;
  wa_id: string;
  date: string;
  win: string;
  room: string;
  status: "held" | "claimed" | "paid";
  expires_at: number;
}

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
    CREATE TABLE IF NOT EXISTS sent_ids (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      data TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed_by_client',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wa_id TEXT NOT NULL,
      date TEXT NOT NULL,
      win TEXT NOT NULL,
      room TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'held',
      expires_at INTEGER NOT NULL,
      lead_id INTEGER
    );
  `);

  // миграция: время последнего сообщения менеджера из приложения (Coexistence echo)
  const cols = db.prepare("PRAGMA table_info(conversations)").all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === "manager_last_at")) {
    db.exec("ALTER TABLE conversations ADD COLUMN manager_last_at TEXT");
  }

  return {
    raw: db,
    /** менеджер написал клиенту с телефона */
    touchManager(wa_id: string) {
      db.prepare("INSERT OR IGNORE INTO conversations (wa_id) VALUES (?)").run(wa_id);
      db.prepare("UPDATE conversations SET manager_last_at = datetime('now') WHERE wa_id = ?").run(wa_id);
    },
    managerActiveWithin(wa_id: string, hours: number): boolean {
      const r = db
        .prepare("SELECT 1 AS x FROM conversations WHERE wa_id = ? AND manager_last_at > datetime('now', ?)")
        .get(wa_id, `-${hours} hours`);
      return !!r;
    },
    botRepliesWithin(wa_id: string, hours: number): number {
      const r = db
        .prepare("SELECT COUNT(*) AS n FROM messages WHERE wa_id = ? AND role = 'assistant' AND created_at > datetime('now', ?)")
        .get(wa_id, `-${hours} hours`) as unknown as { n: number };
      return Number(r.n);
    },
    rememberSent(id: string) {
      db.prepare("INSERT OR IGNORE INTO sent_ids (id) VALUES (?)").run(id);
    },
    isOwnSent(id: string): boolean {
      return !!db.prepare("SELECT 1 AS x FROM sent_ids WHERE id = ?").get(id);
    },
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
    /** Занятые комнаты в окне: оплаченные/заявленные как оплаченные и не истёкшие удержания. */
    busyRooms(date: string, win: string): string[] {
      const rows = db
        .prepare("SELECT room FROM bookings WHERE date = ? AND win = ? AND (status != 'held' OR expires_at > ?)")
        .all(date, win, Date.now()) as unknown as { room: string }[];
      return rows.map((r) => r.room);
    },
    /** Занять слот на время holdMs. Вызывается синхронно, поэтому гонки между клиентами невозможны. */
    holdSlot(wa_id: string, date: string, win: string, room: string, holdMs: number, lead_id: number | null): number {
      const r = db
        .prepare("INSERT INTO bookings (wa_id, date, win, room, expires_at, lead_id) VALUES (?, ?, ?, ?, ?, ?)")
        .run(wa_id, date, win, room, Date.now() + holdMs, lead_id);
      return Number(r.lastInsertRowid);
    },
    latestBooking(wa_id: string): Booking | undefined {
      return db.prepare("SELECT * FROM bookings WHERE wa_id = ? ORDER BY id DESC LIMIT 1").get(wa_id) as unknown as Booking | undefined;
    },
    setBookingStatus(id: number, status: Booking["status"]) {
      db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(status, id);
    },
    /** Снять неоплаченные удержания клиента (отмена, новая бронь, /reset). */
    releaseHeld(wa_id: string) {
      db.prepare("DELETE FROM bookings WHERE wa_id = ? AND status = 'held'").run(wa_id);
    },
    getLead(id: number): Record<string, any> {
      const r = db.prepare("SELECT data FROM leads WHERE id = ?").get(id) as unknown as { data: string } | undefined;
      return r ? JSON.parse(r.data) : {};
    },
    createLead(wa_id: string, data: unknown): number {
      const r = db.prepare("INSERT INTO leads (wa_id, data) VALUES (?, ?)").run(wa_id, JSON.stringify(data));
      return Number(r.lastInsertRowid);
    },
  };
}

export type Db = ReturnType<typeof openDb>;
