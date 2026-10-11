// Формулировка утверждения для кандидата — «под цитату» (ideas.md, «Утверждение — формулировка под цитату»).
// Каталожная `statement` шире цитаты и всегда в мужском роде; кандидат видит `wording`,
// а ранжирование, созвон и работодатель — по-прежнему `statement`.

/** Длина формулировки для карточки, символов. */
export const WORDING_MAX = 160;

const LATIN_OR_NUM = /[A-Za-z][A-Za-z0-9.+#-]*|\d+(?:[.,]\d+)?/g;

function clean(s: string): string {
  return s
    .replace(/[«»"“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Формулировка из самой цитаты: она по построению не шире цитаты и в роде кандидата. */
export function wordingFromQuote(quote: string): string {
  let s = clean(quote).replace(/^[-*•–—\s]+/, '').replace(/[\s.;,:]+$/, '');
  if (s.length > WORDING_MAX) {
    const cut = s.slice(0, WORDING_MAX - 1);
    const sp = cut.lastIndexOf(' ');
    s = `${(sp > WORDING_MAX / 2 ? cut.slice(0, sp) : cut).replace(/[\s.;,:]+$/, '')}…`;
  }
  return s ? s.charAt(0).toLocaleUpperCase('ru') + s.slice(1) : '';
}

/**
 * Формулировка модели принимается, если она не выходит за цитату по тому, что можно проверить кодом:
 * каждая технология (латиница) и каждое число из неё есть в цитате, и она не длиннее цитаты больше чем на 6 слов.
 * Смысловое расширение по-русски («отмена запросов») кодом не ловится — его держит промпт;
 * иначе — формулировка из цитаты.
 */
export function wordingFor(raw: string | undefined, quote: string): string {
  const fallback = wordingFromQuote(quote);
  if (!raw) return fallback;
  const w = clean(raw).replace(/[\s.;,]+$/, '');
  if (w.length < 3 || w.length > WORDING_MAX) return fallback;
  const q = quote.toLocaleLowerCase('ru');
  const tokens = w.match(LATIN_OR_NUM) ?? [];
  if (tokens.some((t) => !q.includes(t.toLocaleLowerCase('ru').replace(/[.,]$/, '')))) return fallback;
  const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
  if (words(w) > words(quote) + 6) return fallback;
  return w.charAt(0).toLocaleUpperCase('ru') + w.slice(1);
}
