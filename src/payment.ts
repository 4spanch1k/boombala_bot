// Предоплата: реквизиты и сумма берутся из .env (бот ничего не придумывает). Проверка поступления подключаемая.
export interface PaymentInfo {
  amount: number;
  requisites: string;
}

/** null, если реквизиты или сумма предоплаты не настроены: тогда оплату ведёт менеджер. */
export function paymentInfo(total: number): PaymentInfo | null {
  const requisites = process.env.PAYMENT_REQUISITES?.trim();
  if (!requisites) return null;
  const fixed = Number(process.env.PREPAYMENT_FIXED);
  const percent = Number(process.env.PREPAYMENT_PERCENT);
  const amount = fixed > 0 ? fixed : percent > 0 ? Math.round((total * percent) / 100 / 100) * 100 : 0;
  return amount > 0 ? { amount, requisites } : null;
}

export type PaymentCheck = "paid" | "not_found" | "unavailable";

export interface PaymentVerifier {
  name: string;
  verify(req: { wa_id: string; amount: number; note: string; hasReceipt: boolean }): Promise<PaymentCheck>;
}

/** Пока нет API банка, поступление проверить нечем: честно отвечаем «не могу проверить», проверяет менеджер. */
const manual: PaymentVerifier = { name: "manual", verify: async () => "unavailable" };

/** Симуляция банка для тренировки: платёж «находится» только если клиент прислал чек (фото или файл). */
const sim: PaymentVerifier = { name: "sim", verify: async (r) => (r.hasReceipt ? "paid" : "not_found") };

const providers: Record<string, PaymentVerifier> = { manual, sim };

export const verifier = (): PaymentVerifier => providers[process.env.PAYMENT_PROVIDER ?? "manual"] ?? manual;
