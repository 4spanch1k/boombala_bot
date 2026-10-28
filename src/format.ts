import type { Channel } from "./policy.js";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Единая разметка модели: **жирный**, списки через «- ». Переводим под каналы. */
export function toWhatsApp(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^\s*[-•]\s+/gm, "• ")
    .replace(/^#{1,6}\s*/gm, "");
}

export function toTelegramHtml(text: string): string {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,!?:;]|$)/g, "$1<b>$2</b>")
    .replace(/^\s*[-•]\s+/gm, "• ")
    .replace(/^#{1,6}\s*/gm, "");
}

export function plain(text: string): string {
  return text.replace(/\*\*?/g, "").replace(/^\s*[-•]\s+/gm, "• ");
}

export function formatFor(channel: Channel, text: string): string {
  return channel === "telegram" ? toTelegramHtml(text) : toWhatsApp(text);
}
