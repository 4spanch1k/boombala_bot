import { appendFileSync } from "node:fs";

/** Уведомление менеджеру: Telegram (если настроен) + консоль + data/notifications.log */
export async function notify(text: string): Promise<void> {
  console.log(`\n[NOTIFY]\n${text}\n`);
  try {
    appendFileSync("data/notifications.log", `${new Date().toISOString()}\n${text}\n\n`);
  } catch {}
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text }),
    });
  } catch (e) {
    console.error("telegram notify failed", e);
  }
}
