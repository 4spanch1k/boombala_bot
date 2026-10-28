// Telegram-канал для тест-драйва: long polling, туннель не нужен. Запуск: npm run tg
import { openDb } from "./db.js";
import { processIncoming } from "./pipeline.js";
import { plain, toTelegramHtml } from "./format.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Нужен TELEGRAM_BOT_TOKEN в .env (создаётся у @BotFather)");
  process.exit(1);
}
const API = `https://api.telegram.org/bot${token}`;
const managerChat = process.env.TELEGRAM_CHAT_ID ?? "";
const db = openDb();

async function api<T = any>(method: string, body: object = {}): Promise<T | null> {
  try {
    const res = await fetch(`${API}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!data.ok) {
      console.error(`telegram ${method} failed:`, data.description);
      return null;
    }
    return data.result ?? null;
  } catch (e) {
    console.error(`telegram ${method} error:`, (e as Error).message);
    return null;
  }
}

async function sendMessage(chatId: number | string, text: string): Promise<string | null> {
  let lastId: string | null = null;
  for (let i = 0; i < text.length; i += 4000) {
    const chunk = text.slice(i, i + 4000);
    let r = await api<{ message_id: number }>("sendMessage", { chat_id: chatId, text: toTelegramHtml(chunk), parse_mode: "HTML" });
    if (!r) r = await api<{ message_id: number }>("sendMessage", { chat_id: chatId, text: plain(chunk) }); // разметка не прошла
    if (r) lastId = `tg:${chatId}:${r.message_id}`;
  }
  return lastId;
}

// сообщения одного клиента обрабатываются по порядку
const chains = new Map<string, Promise<void>>();
function enqueue(key: string, job: () => Promise<void>) {
  const next = (chains.get(key) ?? Promise.resolve()).then(job).catch((e) => console.error("job failed", e));
  chains.set(key, next);
  next.finally(() => chains.get(key) === next && chains.delete(key));
}

const GREETING =
  "Здравствуйте! Я ИИ-помощник детского центра «Бум Бала» 🎈\nСпрашивайте про цены, правила и дни рождения, помогу оформить заявку.\n(Команда /reset начинает диалог заново.)";

function resetConversation(wa_id: string) {
  db.raw.prepare("DELETE FROM messages WHERE wa_id = ?").run(wa_id);
  db.releaseHeld(wa_id);
  db.raw.prepare("UPDATE conversations SET human_mode = 0, stage = 'collecting', draft = '{}', lead_id = NULL WHERE wa_id = ?").run(wa_id);
}

async function onMessage(msg: any) {
  const chatId = String(msg.chat.id);
  // чек приходит фото или файлом: передаём боту пометку, сам файл бот не читает
  const attachment = msg.photo ? "фото" : msg.document ? "файл" : undefined;
  const text: string | undefined = msg.text ?? (attachment ? `[клиент прислал ${attachment}${msg.caption ? `: ${msg.caption}` : ""}]` : undefined);
  if (msg.chat.type !== "private") return; // группа менеджеров и прочее: только уведомления
  const wa_id = `tg_${chatId}`;

  if (text === "/start") return void (await sendMessage(chatId, GREETING));
  if (text === "/id") return void (await sendMessage(chatId, `Ваш chat id: ${chatId}`));
  if (text === "/reset") {
    resetConversation(wa_id);
    return void (await sendMessage(chatId, "Диалог сброшен. Чем могу помочь?"));
  }
  if (!text) {
    return void (await sendMessage(chatId, "Пока я понимаю только текст, фото и файлы. Напишите, пожалуйста, сообщением 🙂"));
  }
  void api("sendChatAction", { chat_id: chatId, action: "typing" });
  await processIncoming(db, "telegram", wa_id, text, (reply) => sendMessage(chatId, reply));
}

async function main() {
  const me = await api<{ username: string }>("getMe");
  if (!me) process.exit(1);
  // на всякий случай снимаем webhook: он мешает long polling
  await api("deleteWebhook", { drop_pending_updates: false });
  console.log(`Telegram-бот @${me.username} запущен. Менеджерский чат: ${managerChat || "не задан (уведомления в консоль)"}`);

  let offset = 0;
  for (;;) {
    const updates = await api<any[]>("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
    if (!updates) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    for (const u of updates) {
      offset = u.update_id + 1;
      if (!u.message || !db.markProcessed(`tgupd:${u.update_id}`)) continue;
      enqueue(String(u.message.chat.id), () => onMessage(u.message));
    }
  }
}

main();
