// Время по МСК (ADR 0008: показываем по МСК, храним в UTC). МСК — постоянное UTC+3, без перехода на летнее время с 2014 г.
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/** «пн, 12.10 14:30 МСК». */
export function formatMsk(iso: string | Date | null | undefined): string {
  if (!iso) return '-';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '-';
  const date = d.toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'Europe/Moscow' });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
  return `${date} ${time} МСК`;
}

/** Поле `datetime-local` («2026-10-12T14:30»), понятое как МСК → ISO UTC. null — не разобрано. */
export function mskLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const utc = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!) - MSK_OFFSET_MS;
  return Number.isNaN(utc) ? null : new Date(utc).toISOString();
}

/** ISO → значение `datetime-local` по МСК. */
export function isoToMskLocal(iso: string | Date): string {
  const d = new Date(new Date(iso).getTime() + MSK_OFFSET_MS);
  return d.toISOString().slice(0, 16);
}
