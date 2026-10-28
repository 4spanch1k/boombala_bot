/**
 * Расчёт стоимости праздника по официальному прайсу boombala.kz (см. knowledge/boombala.md).
 * Считает код, а не модель. Цены пакетов в будни взяты как напечатано на афише, а не вычислены.
 * Когда подключится FastAPI, источником цен станет он, а эта таблица исчезнет.
 */
export const PACKAGES = {
  "WOW PARTY": { full: 37900, weekday: 26530, freeKids: 5 },
  "MAGIC PARTY": { full: 44900, weekday: 31430, freeKids: 6 },
  "BOOM PARTY": { full: 79990, weekday: 55930, freeKids: 6 },
} as const;
export type PackageName = keyof typeof PACKAGES;

const CHILD_TICKET = { weekday: 4000, weekend: 5000 }; // дети 3–15 лет
const COMPANION = 500;
const EXTRA_KID_DISCOUNT = 0.2;

const fmt = (n: number) => `${n.toLocaleString("ru-RU").replace(/ /g, " ")} ₸`;

export function normalizePackage(name: string): PackageName | null {
  const n = name.toUpperCase().replace(/\s+/g, " ").trim();
  return (Object.keys(PACKAGES) as PackageName[]).find((k) => n.includes(k.split(" ")[0])) ?? null;
}

export function isWeekday(isoDate: string): boolean {
  const d = new Date(`${isoDate}T12:00:00+05:00`).getUTCDay(); // 0 вс … 6 сб
  return d >= 1 && d <= 5;
}

export interface Estimate {
  total: number;
  lines: string[];
  assumptions: string[];
}

export function estimate(pkgName: string, isoDate: string, kids: number, adults: number): Estimate | { error: string } {
  const key = normalizePackage(pkgName);
  if (!key) return { error: `неизвестный пакет «${pkgName}»` };
  const weekday = isWeekday(isoDate);
  const pkg = PACKAGES[key];
  const lines: string[] = [];

  const base = weekday ? pkg.weekday : pkg.full;
  lines.push(`${key}${weekday ? " (будни, скидка 30%)" : ""}: ${fmt(base)}`);

  // kids — дети-гости БЕЗ именинника: он проходит бесплатно отдельно, в пакете бесплатно ещё freeKids детей
  const extra = Math.max(0, kids - pkg.freeKids);
  const ticket = weekday ? CHILD_TICKET.weekday : CHILD_TICKET.weekend;
  const extraEach = Math.round(ticket * (1 - EXTRA_KID_DISCOUNT));
  const extraSum = extra * extraEach;
  if (extra > 0) lines.push(`Дополнительные дети: ${extra} × ${fmt(extraEach)} (вход ${fmt(ticket)} −20%) = ${fmt(extraSum)}`);
  else lines.push(`Все дети входят в пакет (бесплатно именинник и ${pkg.freeKids} детей)`);

  const adultSum = adults * COMPANION;
  if (adults > 0) lines.push(`Взрослые: ${adults} × ${fmt(COMPANION)} = ${fmt(adultSum)}`);

  return {
    total: base + extraSum + adultSum,
    lines,
    assumptions: [
      `именинник бесплатно и в число детей не входит; в пакете бесплатно ещё ${pkg.freeKids} детей`,
      "дополнительным детям считается билет 3–15 лет; малыши до 3 лет дешевле, до 1 года бесплатно",
      "если дата праздничная, действует цена выходного дня",
      "предоплату и итог подтверждает менеджер",
    ],
  };
}
