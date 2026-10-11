/** Период метрик (E-08, фаза 5): по умолчанию 30 дней, не больше года – агрегаты считает БД, не память. */
export const DEFAULT_DAYS = 30;
export const MAX_DAYS = 365;

export function parseDays(v: unknown): number {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? Math.trunc(v) : NaN;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAYS;
  return Math.min(n, MAX_DAYS);
}

export function sinceFor(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
