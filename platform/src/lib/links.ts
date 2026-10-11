/**
 * Ссылки в тексте сообщения (композер чата): GitHub, портфолио, статьи. Отдельного поля
 * «ссылки» нет – распознаём их прямо в тексте. Ссылкой считаем токен со схемой, с `www.`,
 * с путём после домена или с доменом частой зоны: так «Node.js» и «Vue.js» не становятся
 * ссылками, а «github.com/name» и «habr.com» – становятся.
 */
const TOKEN = /(?<![@\w.-])((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?(?:\/[^\s<>"«»]*)?)/gi;
const ZONES = new Set(['com', 'ru', 'io', 'dev', 'org', 'net', 'me', 'app', 'tech', 'pro', 'info', 'su', 'xyz', 'site', 'online', 'page', 'so', 'ai', 'co', 'ws', 'cc']);
/** Сколько ссылок за раз принимает конвейер консультанта (POST /api/consultant/messages). */
export const MAX_LINKS = 10;

export function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const raw = m[1]!.replace(/[.,;:!?)\]}»'"]+$/u, '');
    const hasScheme = /^https?:\/\//i.test(raw);
    const host = raw.replace(/^https?:\/\//i, '').split(/[/:]/)[0]!.toLowerCase();
    const zone = host.split('.').pop()!;
    const hasPath = /^(?:https?:\/\/)?[^/]+\/\S/i.test(raw);
    if (!hasScheme && !host.startsWith('www.') && !hasPath && !ZONES.has(zone)) continue;
    try {
      const u = new URL(hasScheme ? raw : `https://${raw}`);
      if (!u.hostname.includes('.')) continue;
      if (typeof window !== 'undefined' && u.origin === window.location.origin) continue;
      const s = u.toString();
      if (!out.includes(s)) out.push(s);
    } catch {
      /* не ссылка */
    }
    if (out.length >= MAX_LINKS) break;
  }
  return out;
}
