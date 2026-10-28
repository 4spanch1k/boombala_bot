import { z } from "zod";
import { who } from "./who.js";
import type { Db } from "./db.js";

export const LeadSchema = z.object({
  name: z.string().min(1).describe("Имя клиента (родителя)"),
  child_name: z.string().min(1).describe("Имя именинника/ребёнка"),
  child_age: z.number().int().min(1).max(18).describe("Возраст ребёнка"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Дата праздника YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/).describe("Время начала HH:MM"),
  kids_count: z.number().int().min(1).max(60).describe("Количество детей"),
  adults_count: z.number().int().min(0).max(60).describe("Количество взрослых"),
  package: z.string().min(1).describe("Название пакета из базы знаний"),
  notes: z.string().optional().describe("Пожелания, допуслуги"),
});
export type Lead = z.infer<typeof LeadSchema>;
export type Draft = Partial<Lead>;

const REQUIRED = Object.keys(LeadSchema.shape).filter((k) => k !== "notes") as (keyof Lead)[];

export function missingFields(draft: Draft): string[] {
  return REQUIRED.filter((k) => draft[k] === undefined || draft[k] === "");
}

export const toolDefs = [
  {
    type: "function" as const,
    function: {
      name: "upsert_lead",
      description:
        "Сохранить/обновить поля заявки на день рождения. Передавайте только те поля, которые клиент сообщил. Телефон не спрашивайте: он известен из WhatsApp. Возвращает список недостающих полей.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          child_name: { type: "string" },
          child_age: { type: "integer" },
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM" },
          kids_count: { type: "integer" },
          adults_count: { type: "integer" },
          package: { type: "string" },
          notes: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "confirm_booking",
      description:
        "Оформить заявку. Вызывать ТОЛЬКО после того, как вы показали клиенту сводку и клиент явно ответил «да/подтверждаю». Если заявка не готова, вернёт ошибку.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "handoff_to_human",
      description:
        "Передать диалог менеджеру: жалоба, возврат, скидка, нестандартный запрос, нет ответа в базе знаний, клиент просит человека.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
          summary: { type: "string", description: "Кратко: что хочет клиент" },
        },
        required: ["reason", "summary"],
      },
    },
  },
];

export interface ToolContext {
  db: Db;
  wa_id: string;
  /** стадия на начало хода: подтверждение возможно только если сводка была показана раньше */
  stageAtTurnStart: string;
  notify: (text: string) => Promise<void>;
}

export async function runTool(name: string, rawArgs: string, ctx: ToolContext): Promise<string> {
  let args: Record<string, unknown> = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: "invalid_json_arguments" });
  }
  const conv = ctx.db.getConversation(ctx.wa_id);
  const draft: Draft = JSON.parse(conv.draft);

  if (name === "upsert_lead") {
    const parsed = LeadSchema.partial().safeParse(args);
    if (!parsed.success) {
      return JSON.stringify({ error: "validation_failed", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
    }
    const merged = { ...draft, ...parsed.data };
    if (merged.date && merged.date < new Date().toISOString().slice(0, 10)) {
      return JSON.stringify({ error: "date_in_past", hint: "Уточните дату у клиента" });
    }
    ctx.db.updateConversation(ctx.wa_id, { draft: JSON.stringify(merged), stage: "collecting" });
    return JSON.stringify({ saved: merged, missing: missingFields(merged) });
  }

  if (name === "confirm_booking") {
    const missing = missingFields(draft);
    if (missing.length) return JSON.stringify({ error: "incomplete", missing });
    if (ctx.stageAtTurnStart !== "awaiting_confirm") {
      return JSON.stringify({ error: "summary_not_shown_yet", hint: "Сначала покажите клиенту сводку и дождитесь его «да»" });
    }
    const lead = LeadSchema.parse(draft);
    const id = ctx.db.createLead(ctx.wa_id, { ...lead, phone: ctx.wa_id });
    ctx.db.updateConversation(ctx.wa_id, { stage: "confirmed", lead_id: id });
    await ctx.notify(
      `🎉 Новая заявка #${id}\nКлиент: ${who(ctx.wa_id)}\n${Object.entries(lead).map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nЖдёт подтверждения менеджера/предоплаты.`,
    );
    return JSON.stringify({ ok: true, lead_id: id, next: "Скажите клиенту, что менеджер свяжется для подтверждения и предоплаты" });
  }

  if (name === "handoff_to_human") {
    ctx.db.updateConversation(ctx.wa_id, { human_mode: 1 });
    await ctx.notify(`🙋 Нужен менеджер\nКлиент: ${who(ctx.wa_id)}\nПричина: ${args.reason}\n${args.summary}`);
    return JSON.stringify({ ok: true });
  }

  return JSON.stringify({ error: "unknown_tool" });
}
