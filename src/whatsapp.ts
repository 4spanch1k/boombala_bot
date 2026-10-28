import { createHmac, timingSafeEqual } from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

export function verifySignature(rawBody: string, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const got = header.slice(7);
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

export interface IncomingMessage {
  id: string;
  from: string;
  type: string;
  text?: string;
}

export function extractMessages(payload: any): IncomingMessage[] {
  const out: IncomingMessage[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        out.push({ id: m.id, from: m.from, type: m.type, text: m.text?.body });
      }
    }
  }
  return out;
}

export interface Echo {
  id: string;
  to: string;
}

/** Сообщения, которые менеджер отправил со своего телефона (поле smb_message_echoes, Coexistence) */
export function extractEchoes(payload: any): Echo[] {
  const out: Echo[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "smb_message_echoes") continue;
      for (const m of change.value?.message_echoes ?? []) out.push({ id: m.id, to: m.to });
    }
  }
  return out;
}

export async function sendText(to: string, body: string): Promise<string | null> {
  const res = await fetch(`${GRAPH}/${process.env.PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
  });
  if (!res.ok) {
    console.error("WhatsApp send failed", res.status, await res.text());
    return null;
  }
  const data = (await res.json()) as { messages?: { id: string }[] };
  return data.messages?.[0]?.id ?? null;
}
