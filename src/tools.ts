import { z } from "zod";
import { who } from "./who.js";
import { estimate } from "./pricing.js";
import { ROOMS, WINDOWS, holdHours, normalizeRoom, windowOf } from "./calendar.js";
import { paymentInfo, verifier } from "./payment.js";
import type { Db } from "./db.js";

export const LeadSchema = z.object({
  name: z.string().min(1).describe("Имя клиента (родителя)"),
  child_name: z.string().min(1).describe("Имя именинника/ребёнка"),
  child_age: z.number().int().min(1).max(18).describe("Возраст ребёнка"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Дата праздника YYYY-MM-DD"),
  time: z.string().regex(/^\d{2}:\d{2}$/).describe("Время начала HH:MM"),
  kids_count: z.number().int().min(1).max(60).describe("Количество детей-гостей, не считая именинника"),
  adults_count: z.number().int().min(0).max(60).describe("Количество взрослых"),
  package: z.string().min(1).describe("Название пакета из базы знаний"),
  notes: z.string().optional().describe("Только пожелания: квест, шоу, комната, торт. НЕ количество гостей"),
  room: z.string().optional().describe("Комната, только если клиент назвал конкретную: Roblox, Ice, Magic или Rapunzel"),
  phone: z.string().regex(/^\+?[0-9()\- ]{10,20}$/).optional().describe("Телефон для связи (нужен только в Telegram)"),
});
export type Lead = z.infer<typeof LeadSchema>;
export type Draft = Partial<Lead>;

const REQUIRED = Object.keys(LeadSchema.shape).filter((k) => k !== "notes" && k !== "phone" && k !== "room") as (keyof Lead)[];

/** needPhone: в Telegram телефона клиента нет, спрашиваем его у клиента. */
export function missingFields(draft: Draft, needPhone = false): string[] {
  const miss: string[] = REQUIRED.filter((k) => draft[k] === undefined || draft[k] === "");
  if (needPhone && !draft.phone) miss.push("phone");
  return miss;
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
          notes: { type: "string", description: "Только пожелания (квест, шоу, комната, торт), не количество гостей" },
          room: { type: "string", description: "Roblox, Ice, Magic или Rapunzel: только если клиент сам назвал комнату" },
          phone: { type: "string", description: "Телефон для связи: только в Telegram, в WhatsApp не спрашивать" },
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
      name: "calculate_price",
      description:
        "Рассчитать стоимость праздника по прайсу (пакет, будни/выходные, дополнительные дети, взрослые). ВСЕГДА используй для суммы вместо ручного счёта. Дети-гости считаются БЕЗ именинника (именинник бесплатно).",
      parameters: {
        type: "object",
        properties: {
          package: { type: "string", description: "WOW PARTY, MAGIC PARTY или BOOM PARTY" },
          date: { type: "string", description: "YYYY-MM-DD" },
          kids_count: { type: "integer", description: "Количество детей-гостей, НЕ считая именинника" },
          adults_count: { type: "integer" },
        },
        required: ["package", "date", "kids_count", "adults_count"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "check_availability",
      description:
        "Проверить свободные окна и комнаты для праздника на дату (и конкретное время, если названо). Единственный источник правды о наличии мест: без вызова не говори, что дата свободна или занята.",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          time: { type: "string", description: "HH:MM, если клиент назвал время" },
        },
        required: ["date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "submit_payment_proof",
      description:
        "Клиент сообщает, что оплатил предоплату (написал «оплатил» или прислал чек/фото). Запускает проверку поступления. Вызывать только когда бронь ждёт оплаты.",
      parameters: { type: "object", properties: { note: { type: "string", description: "Что прислал клиент: сумма, время, имя плательщика, если указаны" } } },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "cancel_booking",
      description: "Отменить бронь, которая ещё не оплачена, и освободить слот. Для оплаченной брони вызови handoff_to_human.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "ask_manager",
      description:
        "Сообщить менеджеру о вопросе клиента, ответа на который нет в базе знаний (часы работы, правила, вместимость и т.п.). Бот НЕ замолкает и продолжает помогать клиенту по остальному.",
      parameters: {
        type: "object",
        properties: { question: { type: "string", description: "Вопрос клиента без ответа" } },
        required: ["question"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "handoff_to_human",
      description:
        "Полностью передать диалог менеджеру (бот замолкает): жалоба, возврат, происшествие, безопасность ребёнка, скидка, нестандартный запрос, клиент просит человека.",
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
    return JSON.stringify({ saved: merged, missing: missingFields(merged, ctx.wa_id.startsWith("tg_")) });
  }

  if (name === "check_availability") {
    const date = String(args.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return JSON.stringify({ error: "нужна дата YYYY-MM-DD" });
    if (date < new Date().toISOString().slice(0, 10)) return JSON.stringify({ error: "date_in_past" });
    const free = WINDOWS.map((w) => ({ window: w, free_rooms: ROOMS.length - ctx.db.busyRooms(date, w).length }));
    if (args.time) {
      const w = windowOf(String(args.time));
      if (!w) return JSON.stringify({ error: "time_outside_windows", windows: WINDOWS });
      const f = free.find((x) => x.window === w)!;
      return JSON.stringify({ date, window: w, free: f.free_rooms > 0, free_rooms: f.free_rooms, other_windows: free.filter((x) => x.window !== w && x.free_rooms > 0).map((x) => x.window) });
    }
    return JSON.stringify({ date, windows: free.map((x) => ({ window: x.window, free: x.free_rooms > 0 })) });
  }

  if (name === "confirm_booking") {
    const missing = missingFields(draft, ctx.wa_id.startsWith("tg_"));
    if (missing.length) return JSON.stringify({ error: "incomplete", missing });
    if (ctx.stageAtTurnStart !== "awaiting_confirm") {
      return JSON.stringify({ error: "summary_not_shown_yet", hint: "Сначала покажите клиенту сводку и дождитесь его «да»" });
    }
    const lead = LeadSchema.parse(draft);
    const win = windowOf(lead.time);
    if (!win) return JSON.stringify({ error: "time_outside_windows", windows: WINDOWS, hint: "Предложите время внутри окон центра" });

    ctx.db.releaseHeld(ctx.wa_id); // повторное подтверждение заменяет прежнее удержание
    const busy = ctx.db.busyRooms(lead.date, win);
    const wanted = lead.room ? normalizeRoom(lead.room) : null;
    const room = wanted ? (busy.includes(wanted) ? null : wanted) : ROOMS.find((r) => !busy.includes(r)) ?? null;
    if (!room) {
      const others = WINDOWS.filter((w) => w !== win && ctx.db.busyRooms(lead.date, w).length < ROOMS.length);
      return JSON.stringify({
        error: wanted ? "room_taken" : "slot_taken",
        free_rooms: ROOMS.filter((r) => !busy.includes(r)),
        other_windows: others,
        hint: "Предложите клиенту другую комнату/окно/дату и обновите заявку через upsert_lead; подтверждение спросите заново",
      });
    }

    const phone = lead.phone ?? `+${ctx.wa_id}`;
    const est = estimate(lead.package, lead.date, lead.kids_count, lead.adults_count);
    const total = "error" in est ? 0 : est.total;
    const fmt = (n: number) => `${n.toLocaleString("ru-RU").replace(/\u00a0/g, " ")} ₸`;
    const estText = "error" in est ? "расчёт не выполнен" : `${fmt(est.total)} (${est.lines.join("; ")})`;
    const id = ctx.db.createLead(ctx.wa_id, { ...lead, phone });
    ctx.db.holdSlot(ctx.wa_id, lead.date, win, room, holdHours() * 3600_000, id);
    const pay = total ? paymentInfo(total) : null;
    ctx.db.updateConversation(ctx.wa_id, { stage: pay ? "awaiting_payment" : "confirmed", lead_id: id });
    await ctx.notify(
      `🎉 Новая заявка #${id}\nКлиент: ${who(ctx.wa_id)}\nТелефон: ${phone}\nСлот: ${lead.date}, ${win}, ${room} (удержан на ${holdHours()} ч)\nРасчёт по прайсу: ${estText}\n${Object.entries(lead).filter(([k]) => k !== "phone").map(([k, v]) => `${k}: ${v}`).join("\n")}\n\n${pay ? `Бот запросил предоплату ${fmt(pay.amount)} и ждёт оплату.` : "Реквизиты предоплаты не настроены: нужна связь менеджера для оплаты и подтверждения."}`,
    );
    const booking = { date: lead.date, window: win, room };
    if (!pay) {
      return JSON.stringify({ ok: true, lead_id: id, booking, next: "Слот за клиентом закреплён предварительно. Скажи, что менеджер свяжется для предоплаты и окончательного подтверждения. Не обещай сроков" });
    }
    return JSON.stringify({
      ok: true, lead_id: id, booking,
      prepayment: fmt(pay.amount), requisites: pay.requisites, hold_hours: holdHours(),
      next: `Слот закреплён предварительно на ${holdHours()} ч до предоплаты. Сообщи клиенту точную сумму предоплаты и реквизиты из этого результата (не меняй цифры), попроси после оплаты написать «оплатил» и прислать чек. Бронь станет окончательной после проверки оплаты`,
    });
  }

  if (name === "submit_payment_proof") {
    const b = ctx.db.latestBooking(ctx.wa_id);
    if (!b || conv.stage !== "awaiting_payment") return JSON.stringify({ error: "нет брони, ожидающей оплаты" });
    if (b.status === "held" && b.expires_at < Date.now()) {
      // удержание истекло: пробуем вернуть тот же слот, иначе отдаём менеджеру
      if (ctx.db.busyRooms(b.date, b.win).includes(b.room)) {
        await ctx.notify(`⚠️ Клиент ${who(ctx.wa_id)} оплатил после истечения удержания, а слот ${b.date} ${b.win} ${b.room} уже занят. Нужна связь с клиентом.`);
        ctx.db.updateConversation(ctx.wa_id, { human_mode: 1 });
        return JSON.stringify({ error: "hold_expired_slot_taken", instruction: "Извинись: слот уже занят другим клиентом, менеджер свяжется и решит вопрос с оплатой" });
      }
    }
    const lead: Partial<Lead> = conv.lead_id ? ctx.db.getLead(conv.lead_id) : {};
    const est = lead.package && lead.date ? estimate(lead.package, lead.date, lead.kids_count ?? 0, lead.adults_count ?? 0) : null;
    const pay = est && !("error" in est) ? paymentInfo(est.total) : null;
    const check = await verifier().verify({ wa_id: ctx.wa_id, amount: pay?.amount ?? 0, note: String(args.note ?? "") });
    if (check === "paid") {
      ctx.db.setBookingStatus(b.id, "paid");
      ctx.db.updateConversation(ctx.wa_id, { stage: "paid" });
      await ctx.notify(`✅ Предоплата подтверждена автоматически\nКлиент: ${who(ctx.wa_id)}\nБронь: ${b.date}, ${b.win}, ${b.room}`);
      return JSON.stringify({ ok: true, status: "paid", instruction: "Подтверди клиенту бронь: дата, окно, комната. Поблагодари" });
    }
    if (check === "not_found") {
      return JSON.stringify({ ok: false, status: "not_found", instruction: "Оплату не нашли. Попроси проверить сумму, реквизиты и прислать чек ещё раз. Ничего не подтверждай" });
    }
    // проверить нечем: слот закрепляем за клиентом и просим менеджера проверить поступление
    ctx.db.setBookingStatus(b.id, "claimed");
    await ctx.notify(`💳 Клиент ${who(ctx.wa_id)} сообщил об оплате, проверка автоматически недоступна. Проверьте поступление${pay ? ` ${pay.amount} ₸` : ""} и подтвердите бронь ${b.date}, ${b.win}, ${b.room}.\nКомментарий клиента: ${args.note ?? "-"}`);
    return JSON.stringify({ ok: true, status: "checking", instruction: "Скажи клиенту, что платёж проверяется и бронь будет подтверждена после проверки. Не говори, что бронь подтверждена, и не обещай сроков" });
  }

  if (name === "cancel_booking") {
    const b = ctx.db.latestBooking(ctx.wa_id);
    if (!b) return JSON.stringify({ error: "нет брони" });
    if (b.status !== "held") return JSON.stringify({ error: "booking_paid_or_claimed", instruction: "Бронь уже оплачена или оплата заявлена: вызови handoff_to_human, возвраты решает менеджер" });
    ctx.db.releaseHeld(ctx.wa_id);
    ctx.db.updateConversation(ctx.wa_id, { stage: "collecting" });
    await ctx.notify(`🚫 Клиент ${who(ctx.wa_id)} отменил неоплаченную бронь ${b.date}, ${b.win}, ${b.room}. Слот освобождён.`);
    return JSON.stringify({ ok: true });
  }

  if (name === "calculate_price") {
    const a = args as { package?: string; date?: string; kids_count?: number; adults_count?: number };
    if (!a.package || !a.date || !Number.isInteger(a.kids_count) || !Number.isInteger(a.adults_count)) {
      return JSON.stringify({ error: "нужны package, date, kids_count, adults_count" });
    }
    const r = estimate(a.package, a.date, a.kids_count as number, a.adults_count as number);
    return JSON.stringify("error" in r ? r : { ...r, total_text: `${r.total.toLocaleString("ru-RU").replace(/\u00a0/g, " ")} ₸` });
  }

  if (name === "ask_manager") {
    await ctx.notify(`❓ Вопрос без ответа в базе\nКлиент: ${who(ctx.wa_id)}\n${args.question}`);
    return JSON.stringify({ ok: true, instruction: "Скажи клиенту, что уточнишь у менеджера, и продолжай помогать по остальному" });
  }

  if (name === "handoff_to_human") {
    ctx.db.updateConversation(ctx.wa_id, { human_mode: 1 });
    await ctx.notify(`🙋 Нужен менеджер\nКлиент: ${who(ctx.wa_id)}\nПричина: ${args.reason}\n${args.summary}`);
    return JSON.stringify({ ok: true });
  }

  return JSON.stringify({ error: "unknown_tool" });
}
