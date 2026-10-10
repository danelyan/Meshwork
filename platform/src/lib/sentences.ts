/**
 * Реплика ИИ → предложения для озвучки и перебивания. Общий модуль клиента и сервера: клиент озвучивает
 * реплику по предложениям и считает, сколько прозвучало; сервер по тому же разбиению обрезает реплику
 * до услышанного (POST /api/call/{id}/interrupt). Разбиение детерминировано — счёт сходится.
 * Принцип — moko/backend/app/meetup/sentences.py: короткие куски клеятся к следующему, длинный текст
 * без знаков конца предложения режется принудительно.
 */

/** Предложение короче — клеим к следующему: «Да.» отдельным вызовом TTS не окупается. */
export const MIN_SENTENCE_CHARS = 12;
/** Кусок без знаков конца предложения длиннее — режем по последнему пробелу. */
export const MAX_SENTENCE_CHARS = 160;

const BOUNDARY_RE = /(?<=[.!?…])\s+/u;

export function splitSentences(text: string): string[] {
  const parts = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(BOUNDARY_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = '';
  for (const p of parts) {
    buf = buf ? `${buf} ${p}` : p;
    if (buf.length >= MIN_SENTENCE_CHARS) {
      out.push(...forceSplit(buf));
      buf = '';
    }
  }
  if (buf) {
    if (out.length) out[out.length - 1] = `${out[out.length - 1]} ${buf}`;
    else out.push(buf);
  }
  return out;
}

function forceSplit(s: string): string[] {
  if (s.length <= MAX_SENTENCE_CHARS) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > MAX_SENTENCE_CHARS) {
    const cut = rest.lastIndexOf(' ', MAX_SENTENCE_CHARS);
    const at = cut > MAX_SENTENCE_CHARS / 2 ? cut : MAX_SENTENCE_CHARS;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** Услышанная часть реплики: первые `heard` предложений. */
export function heardPrefix(text: string, heard: number): { heard: string; tail: string; total: number } {
  const s = splitSentences(text);
  const n = Math.max(0, Math.min(heard, s.length));
  return { heard: s.slice(0, n).join(' '), tail: s.slice(n).join(' '), total: s.length };
}

/** Пометка перебитой реплики в транскрипте (как в moko: «…(перебит)»). */
export const INTERRUPTED_MARK = '…(перебит)';
export const UNHEARD_MARK = '…(не прозвучало: кандидат заговорил раньше)';

/** Короткие поддакивания: такое «перебивание» — не ответ, озвучка продолжается (moko director fast-path). */
const BACKCHANNEL = new Set(['угу', 'ага', 'да', 'да-да', 'ну да', 'ок', 'окей', 'хм', 'мм', 'понял', 'поняла', 'понятно', 'ясно', 'хорошо', 'так', 'продолжай', 'продолжайте', 'дальше', 'угу-угу', 'ясно-ясно']);
const BACKCHANNEL_MAX_CHARS = 18;

export function isBackchannel(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s-]+/gu, '').replace(/\s+/g, ' ').trim();
  if (!t || t.length > BACKCHANNEL_MAX_CHARS) return false;
  return BACKCHANNEL.has(t) || t.split(' ').every((w) => BACKCHANNEL.has(w));
}
