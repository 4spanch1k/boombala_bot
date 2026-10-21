// Локальный чат с мозгом бота без WhatsApp: npm run chat
import { createInterface } from "node:readline/promises";
import { openDb } from "./db.js";
import { handleMessage } from "./brain.js";
import { notify } from "./notify.js";

const db = openDb(":memory:");
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("Чат с ботом (Ctrl+C — выход)");
while (true) {
  const text = await rl.question("\nВы: ");
  const { reply, toolCalls } = await handleMessage(db, "77000000000", text, notify);
  if (toolCalls.length) console.log(`  [tools: ${toolCalls.join(", ")}]`);
  console.log(`Бот: ${reply ?? "(молчит — диалог у менеджера)"}`);
}
