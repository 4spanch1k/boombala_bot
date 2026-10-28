import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { who } from "./who.js";
import type { Db } from "./db.js";
import { missingFields, runTool, toolDefs, type Draft } from "./tools.js";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "missing",
  baseURL: "https://api.deepseek.com",
});
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
const MAX_TOOL_ROUNDS = 5;

const knowledge = () => readFileSync(new URL("../knowledge/boombala.md", import.meta.url), "utf8");

function systemPrompt(draft: Draft, stage: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `Ты — менеджер детского центра «Бум Бала» (Алматы), отвечаешь клиентам в мессенджере (WhatsApp или Telegram).

ПРАВИЛА
- Отвечай на языке клиента (русский или казахский). Коротко, тепло, одним сообщением. Без длинных списков.
- Цены, часы, правила и пакеты называй ТОЛЬКО из базы знаний ниже. Нет ответа в базе (часы работы, правила, вместимость, состав блюд и т.п.) — скажи, что уточнишь у менеджера, вызови ask_manager (бот продолжает работать) и предложи помочь с остальным. Ничего не выдумывай.
- Говори только о теме центра (посещение, дни рождения, цены, запись). На посторонние темы вежливо верни разговор к центру.
- Бронирование дня рождения: собери поля заявки через upsert_lead (телефон не спрашивай). Дату вычисляй относительно сегодняшней (${today}), формат YYYY-MM-DD. Если данные неясны (например, нет года или время неразборчиво) — переспроси.
- Когда все поля собраны, покажи клиенту сводку (дата, время, дети/взрослые, пакет, пожелания, цена из базы) и спроси «Подтверждаете?». confirm_booking вызывай только после явного «да» клиента на сводку, в следующем сообщении.
- Жалоба, возврат, происшествие, безопасность ребёнка, скидка, нестандартный запрос, просьба позвать человека — handoff_to_human (бот замолкает) и скажи клиенту, что менеджер скоро ответит.
- Свободных слотов бот не видит: не обещай, что дата свободна. Скажи, что менеджер подтвердит наличие мест после заявки.
- Если сообщение — расшифровка голосового (пометка [голосовое]), возможны ошибки распознавания: при сомнении переспроси.

ТЕКУЩАЯ СТАДИЯ: ${stage}
ЧЕРНОВИК ЗАЯВКИ: ${JSON.stringify(draft)}
НЕ ХВАТАЕТ ПОЛЕЙ: ${JSON.stringify(missingFields(draft))}

БАЗА ЗНАНИЙ
${knowledge()}`;
}

/** Короткие сетевые сбои не должны отправлять клиента к менеджеру: пробуем ещё раз. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  throw last;
}

export interface HandleResult {
  reply: string | null; // null — бот молчит (human_mode)
  toolCalls: string[];
}

export async function handleMessage(
  db: Db,
  wa_id: string,
  text: string,
  notify: (t: string) => Promise<void>,
): Promise<HandleResult> {
  db.addMessage(wa_id, "user", text);
  const conv = db.getConversation(wa_id);
  if (conv.human_mode) return { reply: null, toolCalls: [] };

  const stageAtTurnStart = conv.stage;
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt(JSON.parse(conv.draft), conv.stage) },
    ...db.history(wa_id),
  ];
  const toolCalls: string[] = [];
  let reply = "";

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await withRetry(() =>
        client.chat.completions.create({ model: MODEL, messages, tools: toolDefs, temperature: 0.3 }),
      );
      const msg = res.choices[0].message;
      messages.push(msg);
      if (!msg.tool_calls?.length) {
        reply = msg.content?.trim() ?? "";
        break;
      }
      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        toolCalls.push(call.function.name);
        const result = await runTool(call.function.name, call.function.arguments, {
          db, wa_id, stageAtTurnStart, notify,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
  } catch (e) {
    console.error("LLM error", e);
    reply = "";
  }

  if (!reply) {
    // сбой ИИ: не замолкаем навсегда, просим повторить и сообщаем менеджеру
    reply = "Извините, небольшой технический сбой. Повторите, пожалуйста, ваше сообщение через минуту 🙏";
    await notify(`⚠️ Сбой ИИ при ответе клиенту ${who(wa_id)}. Последнее сообщение: ${text}`);
  }

  // если заявка собрана полностью и ещё не подтверждена — ждём «да» на следующем ходе
  const after = db.getConversation(wa_id);
  if (after.stage === "collecting" && missingFields(JSON.parse(after.draft)).length === 0) {
    db.updateConversation(wa_id, { stage: "awaiting_confirm" });
  }

  db.addMessage(wa_id, "assistant", reply);
  return { reply, toolCalls };
}
