// Ручное подтверждение оплаты, пока нет проверки через API банка: npm run paid -- <wa_id | tg_chatId>
// Без аргументов показывает брони, у которых клиент заявил об оплате.
import { openDb } from "./db.js";

const db = openDb();
const id = process.argv[2];

if (!id) {
  const rows = db.raw.prepare("SELECT wa_id, date, win, room FROM bookings WHERE status = 'claimed'").all() as unknown as { wa_id: string; date: string; win: string; room: string }[];
  console.log(rows.length ? rows.map((r) => `${r.wa_id}: ${r.date}, ${r.win}, ${r.room}`).join("\n") : "Нет броней, ждущих проверки оплаты");
  process.exit(0);
}

const b = db.latestBooking(id);
if (!b || b.status === "paid") {
  console.error(b ? "Бронь уже оплачена" : "Бронь не найдена");
  process.exit(1);
}
db.setBookingStatus(b.id, "paid");
db.updateConversation(id, { stage: "paid" });
console.log(`Бронь подтверждена: ${b.date}, ${b.win}, ${b.room}`);

const token = process.env.TELEGRAM_BOT_TOKEN;
if (id.startsWith("tg_") && token) {
  const text = `Оплату получили, бронь подтверждена ✅\n📅 ${b.date}, ${b.win}\n🚪 ${b.room}\nЖдём вас на празднике 🎉`;
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: id.slice(3), text }),
  });
  console.log(r.ok ? "Клиенту отправлено подтверждение" : "Клиенту не отправилось");
} else {
  console.log("Сообщите клиенту о подтверждении вручную (автоотправка пока только для Telegram)");
}
