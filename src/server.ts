import { createServer } from "node:http";
import { openDb } from "./db.js";
import { processIncoming } from "./pipeline.js";
import { extractEchoes, extractMessages, sendText, verifySignature } from "./whatsapp.js";
import { currentMode } from "./policy.js";

const db = openDb();
const PORT = Number(process.env.PORT ?? 3000);

// простая очередь на диалог, чтобы сообщения одного клиента обрабатывались по порядку
const chains = new Map<string, Promise<void>>();
function enqueue(wa_id: string, job: () => Promise<void>) {
  const prev = chains.get(wa_id) ?? Promise.resolve();
  const next = prev.then(job).catch((e) => console.error("job failed", e));
  chains.set(wa_id, next);
  next.finally(() => chains.get(wa_id) === next && chains.delete(wa_id));
}

function processWhatsApp(wa_id: string, text: string) {
  return processIncoming(db, "whatsapp", wa_id, text, (reply) => sendText(wa_id, reply));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (req.method === "GET" && url.pathname === "/webhook") {
    if (url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === process.env.VERIFY_TOKEN) {
      res.writeHead(200).end(url.searchParams.get("hub.challenge") ?? "");
    } else res.writeHead(403).end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/webhook") {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!verifySignature(raw, req.headers["x-hub-signature-256"] as string | undefined, process.env.APP_SECRET ?? "")) {
        res.writeHead(401).end();
        return;
      }
      res.writeHead(200).end(); // отвечаем Meta сразу
      let payload: unknown;
      try { payload = JSON.parse(raw); } catch { return; }
      // сообщения менеджера с телефона: в этом чате бот на время замолкает
      for (const e of extractEchoes(payload)) {
        if (!db.isOwnSent(e.id)) db.touchManager(e.to);
      }
      for (const m of extractMessages(payload)) {
        if (!db.markProcessed(m.id)) continue; // дубль
        enqueue(m.from, async () => {
          if (m.type === "text" && m.text) return processWhatsApp(m.from, m.text);
          // голосовые/фото — на втором этапе
          await sendText(m.from, "Пока я понимаю только текст. Напишите, пожалуйста, сообщением 🙂");
        });
      }
    });
    return;
  }

  res.writeHead(404).end();
}).listen(PORT, () => console.log(`Webhook listening on :${PORT}/webhook, BOT_MODE=${currentMode()}`));
