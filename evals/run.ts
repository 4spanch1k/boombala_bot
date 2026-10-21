import { readFileSync } from "node:fs";
import { openDb } from "../src/db.js";
import { handleMessage } from "../src/brain.js";

interface Turn {
  user: string;
  expectTools?: string[];
  forbidTools?: string[];
  replyMustMatch?: string;
  replyMustNotMatch?: string;
}
interface Case { name: string; turns: Turn[] }

const cases: Case[] = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url), "utf8"));
const filter = process.argv[2];
let failed = 0;

for (const c of cases.filter((c) => !filter || c.name.includes(filter))) {
  const db = openDb(":memory:");
  const problems: string[] = [];
  const transcript: string[] = [];
  for (const [i, t] of c.turns.entries()) {
    const { reply, toolCalls } = await handleMessage(db, "77001112233", t.user, async () => {});
    transcript.push(`  Клиент: ${t.user}`, `  Бот: ${reply ?? "(молчит)"}  [tools: ${toolCalls.join(", ") || "-"}]`);
    for (const x of t.expectTools ?? []) if (!toolCalls.includes(x)) problems.push(`ход ${i + 1}: ожидался tool ${x}`);
    for (const x of t.forbidTools ?? []) if (toolCalls.includes(x)) problems.push(`ход ${i + 1}: запрещённый tool ${x}`);
    if (t.replyMustMatch && !new RegExp(t.replyMustMatch, "i").test(reply ?? "")) problems.push(`ход ${i + 1}: ответ не соответствует /${t.replyMustMatch}/`);
    if (t.replyMustNotMatch && new RegExp(t.replyMustNotMatch, "i").test(reply ?? "")) problems.push(`ход ${i + 1}: ответ содержит запрещённое /${t.replyMustNotMatch}/`);
  }
  console.log(`${problems.length ? "❌" : "✅"} ${c.name}`);
  if (problems.length) {
    failed++;
    console.log(transcript.join("\n"));
    for (const p of problems) console.log(`  ! ${p}`);
  }
}
console.log(failed ? `\nПровалено: ${failed}` : "\nВсе сценарии прошли");
process.exit(failed ? 1 : 0);
