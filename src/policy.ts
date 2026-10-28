import type { Db } from "./db.js";

export type Channel = "whatsapp" | "telegram";
export type BotMode = "off" | "allowlist" | "shadow" | "live";
export type Decision = { action: "reply" | "draft" | "ignore"; reason: string; rateLimited?: boolean };

const digits = (s: string) => s.replace(/\D/g, "");

export function currentMode(channel: Channel = "whatsapp"): BotMode {
  // Telegram-бот закрытый тестовый: по умолчанию отвечает всем, кто ему написал
  const raw = channel === "telegram" ? (process.env.TELEGRAM_MODE ?? "live") : (process.env.BOT_MODE ?? "allowlist");
  const m = raw.toLowerCase();
  return (["off", "allowlist", "shadow", "live"] as const).includes(m as BotMode) ? (m as BotMode) : "off";
}

function allowlist(): Set<string> {
  return new Set((process.env.BOT_ALLOWLIST ?? "").split(",").map(digits).filter(Boolean));
}

/** Решает, что делать с входящим сообщением. Любая неопределённость = молчим. */
export function decide(db: Db, wa_id: string, channel: Channel = "whatsapp"): Decision {
  const mode = currentMode(channel);
  if (mode === "off") return { action: "ignore", reason: "BOT_MODE=off" };
  if (mode === "allowlist" && !allowlist().has(digits(wa_id))) return { action: "ignore", reason: "номер не в BOT_ALLOWLIST" };

  const cooldown = Number(process.env.MANAGER_COOLDOWN_HOURS ?? 12);
  if (db.managerActiveWithin(wa_id, cooldown)) return { action: "ignore", reason: `менеджер писал в чат за последние ${cooldown} ч` };

  // WhatsApp: защита от зацикливания и лишних расходов. Telegram-тест: без лимита (0 = выключен)
  const max =
    channel === "telegram"
      ? Number(process.env.TELEGRAM_MAX_REPLIES_PER_HOUR ?? 0)
      : Number(process.env.MAX_REPLIES_PER_HOUR ?? 30);
  if (max > 0 && db.botRepliesWithin(wa_id, 1) >= max) {
    return { action: "ignore", reason: `лимит ${max} ответов в час`, rateLimited: true };
  }

  return { action: mode === "shadow" ? "draft" : "reply", reason: mode };
}
