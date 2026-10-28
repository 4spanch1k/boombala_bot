// Собственный календарь бота: 4 праздничные комнаты × 3 окна. Видит только брони, принятые самим ботом.
export const WINDOWS = ["10:00–14:00", "14:00–18:00", "18:00–22:00"] as const;
export const ROOMS = ["Roblox Room", "Ice Room", "Magic Room", "Rapunzel Room"] as const;

/** Окно, в которое попадает время начала праздника; null — время вне окон центра. */
export function windowOf(time: string): (typeof WINDOWS)[number] | null {
  const h = Number(time.slice(0, 2));
  if (h >= 10 && h < 14) return WINDOWS[0];
  if (h >= 14 && h < 18) return WINDOWS[1];
  if (h >= 18 && h < 22) return WINDOWS[2];
  return null;
}

/** «ice», «Ice Room» → «Ice Room»; неизвестное название → null. */
export function normalizeRoom(name: string): (typeof ROOMS)[number] | null {
  const first = name.trim().toLowerCase().split(/\s+/)[0];
  return ROOMS.find((r) => r.toLowerCase().startsWith(first)) ?? null;
}

export const holdHours = () => Number(process.env.HOLD_HOURS) || 24;
