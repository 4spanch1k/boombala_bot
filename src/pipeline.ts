import type { Db } from "./db.js";
import { handleMessage } from "./brain.js";
import { notify } from "./notify.js";
import { decide, type Channel } from "./policy.js";
import { who } from "./who.js";

/** Общий путь входящего сообщения для всех каналов. send отправляет ответ клиенту и возвращает id сообщения. */
export async function processIncoming(
  db: Db,
  channel: Channel,
  wa_id: string,
  text: string,
  send: (reply: string) => Promise<string | null>,
): Promise<void> {
  const d = decide(db, wa_id, channel);
  if (d.action === "ignore") {
    db.addMessage(wa_id, "user", text); // только сохраняем, бот молчит
    console.log(`[policy] ignore ${who(wa_id)}: ${d.reason}`);
    return;
  }
  const { reply } = await handleMessage(db, wa_id, text, notify);
  if (!reply) return;
  if (d.action === "draft") {
    await notify(`✏️ ЧЕРНОВИК (не отправлен) для ${who(wa_id)}\nКлиент: ${text}\nБот ответил бы: ${reply}`);
    return;
  }
  const id = await send(reply);
  if (id) db.rememberSent(id);
}
