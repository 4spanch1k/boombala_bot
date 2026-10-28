/** Человекочитаемое имя собеседника для уведомлений: телефон WhatsApp или чат Telegram. */
export function who(wa_id: string): string {
  return wa_id.startsWith("tg_") ? `Telegram ${wa_id.slice(3)}` : `+${wa_id}`;
}
