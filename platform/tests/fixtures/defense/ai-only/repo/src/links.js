import { decode, encode } from './codec.js';

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

export function normalizeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (BLOCKED_HOSTS.has(url.hostname)) return null;
  url.hash = '';
  return url.toString();
}

export class LinkService {
  constructor({ startAt = 100_000 } = {}) {
    this.next = startAt;
    this.byId = new Map();
    this.byUrl = new Map();
  }

  shorten(raw) {
    const url = normalizeUrl(raw);
    if (!url) return { ok: false, error: 'invalid_url' };
    const existing = this.byUrl.get(url);
    if (existing !== undefined) return { ok: true, code: encode(existing), reused: true };
    const id = this.next++;
    this.byId.set(id, { url, hits: 0, createdAt: Date.now() });
    this.byUrl.set(url, id);
    return { ok: true, code: encode(id), reused: false };
  }

  resolve(code) {
    const id = decode(code);
    if (id === null) return null;
    const link = this.byId.get(id);
    if (!link) return null;
    link.hits += 1;
    return link.url;
  }
}
