/**
 * Арифметика плавного раскрытия текста (стрим консультанта/помощника, реплики онбординга).
 * Чистые функции без DOM — покрыты unit-тестами.
 *
 * Курсор `pos` догоняет длину цели со скоростью max(пол, отставание / τ): большой кусок
 * раскрывается быстро и замедляется к концу, маленький — не медленнее пола. Пока поток идёт,
 * τ ≈ 0,6 с (отстаём от источника не больше чем на полсекунды); после `done` хвост дописывается
 * за ≈ 0,2 с. `paced` — для текста, известного целиком: постоянная «читаемая» скорость.
 * Видимая граница — по целым словам, чтобы слово не рвалось посередине.
 */
export type RevealMode = 'streaming' | 'settling' | 'paced';

const STREAM_TAU_S = 0.6;
const STREAM_MIN_CPS = 60;
const SETTLE_TAU_S = 0.2;
const SETTLE_MIN_CPS = 400;
/** Готовая реплика раскрывается примерно за 2,5 с: не медленнее 160 и не быстрее 700 зн/с. */
const PACED_TARGET_S = 2.5;
const PACED_MIN_CPS = 160;
const PACED_MAX_CPS = 700;
/** Кадр, пришедший с опозданием (главный поток занят), не двигает курсор больше чем на 50 мс. */
export const MAX_FRAME_DT_MS = 50;
/** Длинное «слово» (URL) не держим целиком — показываем по символам. */
const LONG_WORD = 24;

export function revealRateCps(mode: RevealMode, backlog: number, total: number): number {
  if (mode === 'paced') return Math.min(PACED_MAX_CPS, Math.max(PACED_MIN_CPS, total / PACED_TARGET_S));
  if (mode === 'settling') return Math.max(SETTLE_MIN_CPS, backlog / SETTLE_TAU_S);
  return Math.max(STREAM_MIN_CPS, backlog / STREAM_TAU_S);
}

/** Новый курсор после кадра длительностью dtMs. */
export function stepReveal(pos: number, total: number, dtMs: number, mode: RevealMode): number {
  if (pos >= total) return total;
  const cps = revealRateCps(mode, total - pos, total);
  const dt = Math.min(MAX_FRAME_DT_MS, Math.max(0, dtMs));
  return Math.min(total, pos + (cps * dt) / 1000);
}

/** Видимая длина: только целые слова; недописанное последнее слово — когда поток закончен. */
export function visibleCut(text: string, pos: number, streamDone: boolean): number {
  const p = Math.min(text.length, Math.max(0, Math.floor(pos)));
  if (p >= text.length) return streamDone ? text.length : lastBreak(text, p);
  if (/\s/u.test(text[p]!)) return p;
  const start = lastBreak(text, p);
  return p - start > LONG_WORD ? p : start;
}

/** Позиция сразу после последнего пробела до `end` (0, если пробелов нет). */
function lastBreak(s: string, end: number): number {
  for (let i = end - 1; i >= 0; i--) if (/\s/u.test(s[i]!)) return i + 1;
  return 0;
}
