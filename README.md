# Бум Бала — ИИ-менеджер WhatsApp

Мозг: DeepSeek (OpenAI-совместимый API) + tools. Канал: WhatsApp Cloud API (тестовый номер Meta).

## Быстрый старт
```bash
npm install
cp .env.example .env     # заполните DEEPSEEK_API_KEY
npm run chat             # проверить мозг в консоли, без WhatsApp
npm run eval             # прогнать сценарии из evals/cases.json
```

## Подключение WhatsApp (бесплатный тест)
1. developers.facebook.com → Create App → Business → добавить продукт WhatsApp.
2. WhatsApp → API Setup: возьмите тестовый номер, `Phone number ID`, временный токен; добавьте свой номер в «To».
3. Settings → Basic: `App Secret`. Всё положите в `.env`, `VERIFY_TOKEN` придумайте сами.
4. `npm start` и в другом терминале `ngrok http 3000`.
5. WhatsApp → Configuration → Webhook: Callback URL `https://<ngrok>/webhook`, Verify token как в `.env`, подписка на поле `messages`.
6. Напишите на тестовый номер из WhatsApp.

## Структура
- `knowledge/boombala.md` — база знаний (замените заглушки на реальные данные)
- `src/brain.ts` — промпт + цикл tool calling
- `src/tools.ts` — upsert_lead / confirm_booking / handoff_to_human, валидация zod
- `src/server.ts` — webhook (подпись, дедупликация, очередь на диалог)
- `evals/` — регрессионные сценарии
