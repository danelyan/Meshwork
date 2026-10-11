/**
 * Арифметика плавного раскрытия текста (стрим консультанта/помощника, реплики онбординга).
 * Чистые функции без DOM – покрыты unit-тестами.
 *
 * Курсор `pos` догоняет длину цели с «человеческой» скоростью (решение владельца 10.10: стрим был
 * слишком быстрым, выглядел искусственно): отставание / τ, но в пределах 45–110 зн/с, пока поток идёт;
 * после `done` хвост дописывается так же, не быстрее 110 зн/с (без рывка в конце). Чтобы длинный ответ
 * не отставал бесконечно, отставание держится не больше ~6 с. `paced` – для текста, известного целиком:
 * реплика раскрывается примерно за 4 с, 70–140 зн/с.
 * Видимая граница – по целым словам, чтобы слово не рвалось посередине.
 */
export type RevealMode = 'streaming' | 'settling' | 'paced';

const STREAM_TAU_S = 2.5;
const STREAM_MIN_CPS = 45;
const SETTLE_MIN_CPS = 70;
const STREAM_MAX_CPS = 110;
/** Больше этого текст не отстаёт от источника: длинный ответ раскрывается быстрее потолка. */
const MAX_LAG_S = 6;
/** Готовая реплика раскрывается примерно за 4 с: не медленнее 70 и не быстрее 140 зн/с. */
const PACED_TARGET_S = 4;
const PACED_MIN_CPS = 70;
const PACED_MAX_CPS = 140;
/** Кадр, пришедший с опозданием (главный поток занят), не двигает курсор больше чем на 50 мс. */
export const MAX_FRAME_DT_MS = 50;
/** Длинное «слово» (URL) не держим целиком – показываем по символам. */
const LONG_WORD = 24;

export function revealRateCps(mode: RevealMode, backlog: number, total: number): number {
  if (mode === 'paced') return Math.min(PACED_MAX_CPS, Math.max(PACED_MIN_CPS, total / PACED_TARGET_S));
  const floor = mode === 'settling' ? SETTLE_MIN_CPS : STREAM_MIN_CPS;
  const cps = Math.min(STREAM_MAX_CPS, Math.max(floor, backlog / STREAM_TAU_S));
  return Math.max(cps, backlog / MAX_LAG_S);
}

/** Новый курсор после кадра длительностью dtMs. */
export function stepReveal(pos: number, total: number, dtMs: number, mode: RevealMode): number {
  if (pos >= total) return total;
  const cps = revealRateCps(mode, total - pos, total);
  const dt = Math.min(MAX_FRAME_DT_MS, Math.max(0, dtMs));
  return Math.min(total, pos + (cps * dt) / 1000);
}

/** Видимая длина: только целые слова; недописанное последнее слово – когда поток закончен. */
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
