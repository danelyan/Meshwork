import { take } from './bucket.js';

// Ключ лимита: API-ключ клиента, если он есть, иначе IP. За прокси IP берётся из
// X-Forwarded-For, только если прокси явно доверенный (иначе клиент подделает заголовок).
export function clientKey(req, { trustProxy = false } = {}) {
  const apiKey = req.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey.length > 0) return `key:${apiKey}`;
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) return `ip:${forwarded.split(',')[0].trim()}`;
  }
  return `ip:${req.socket.remoteAddress}`;
}

export function rateLimit(store, options = {}) {
  const cost = options.cost ?? (() => 1);
  return function rateLimitMiddleware(req, res, next) {
    const key = clientKey(req, options);
    const result = take(store.get(key), store.clock(), cost(req));
    res.setHeader('RateLimit-Limit', String(store.capacity));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      res.statusCode = 429;
      res.end(JSON.stringify({ error: 'rate_limited', retryAfterSec: result.retryAfterSec }));
      return;
    }
    next();
  };
}
