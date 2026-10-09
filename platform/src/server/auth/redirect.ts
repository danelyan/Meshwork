/**
 * Безопасный `next` после входа: только относительный путь этого сайта.
 * Отсекает `//evil`, `/\evil`, `https://…`, управляющие символы и API-пути.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 512) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (/[\u0000-\u001f\\]/.test(raw)) return null;
  try {
    const u = new URL(raw, 'http://local.invalid');
    if (u.origin !== 'http://local.invalid') return null;
    if (u.pathname.startsWith('/api/')) return null;
    return u.pathname + u.search + u.hash;
  } catch {
    return null;
  }
}
