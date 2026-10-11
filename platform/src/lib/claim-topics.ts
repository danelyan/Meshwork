// Тема созвона и склейка карточек утверждений. Чистые функции, без рода.
import type { CardClaim } from './claims-view';

/** Нормализация для сравнения цитат и формулировок. */
export function normText(s: string): string {
  return s.toLocaleLowerCase('ru').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Ведущий глагол прошедшего времени («Строил», «Верстала», «Выбирал,»). */
const LEADING_PAST_VERB = /^[\p{L}-]+(?:л|ла|ли)[,]?\s+/u;

/**
 * Тема для «На созвоне спросим про: …» из каталожного statement без глагола в роде.
 * Часть после «:», если есть; иначе statement без первого слова, если это глагол
 * на -л/-ла/-ли. Нет ни того ни другого («Понимаю …») — пусто, строку не показываем.
 */
export function claimTopic(statement: string): string {
  const s = statement.trim();
  const colon = s.indexOf(':');
  if (colon > 0) return s.slice(colon + 1).trim();
  if (LEADING_PAST_VERB.test(s)) return s.replace(LEADING_PAST_VERB, '').trim();
  return '';
}

/** Темы группы: без пустых и совпадающих с цитатой, без повторов; склейка через «; ». */
export function claimTopics(claims: Pick<CardClaim, 'statement' | 'quote'>[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of claims) {
    const t = claimTopic(c.statement);
    const key = normText(t);
    if (!key || key === normText(c.quote) || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.join('; ');
}

/**
 * Склейка карточек с одной цитатой. Ключ: нормализованная цитата + статус + уровень
 * (разные статусы/уровни не склеиваем, чтобы ничего не терять). Пустая цитата не склеивается.
 * Порядок — по первому вхождению.
 */
export function groupClaimsByQuote(claims: CardClaim[]): CardClaim[][] {
  const groups: CardClaim[][] = [];
  const index = new Map<string, CardClaim[]>();
  for (const c of claims) {
    const q = normText(c.quote);
    if (!q) {
      groups.push([c]);
      continue;
    }
    const key = `${q}|${c.status}|${c.level}`;
    const g = index.get(key);
    if (g) g.push(c);
    else {
      const ng = [c];
      index.set(key, ng);
      groups.push(ng);
    }
  }
  return groups;
}
