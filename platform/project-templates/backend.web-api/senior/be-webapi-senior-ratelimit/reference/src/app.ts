// Эталон: middleware лимита и приложение.
import express, { type Request, type RequestHandler } from 'express';

import type { Limiter } from './limiter';

export function rateLimit(limiter: Limiter, opts: { key: (req: Request) => string | null; cost?: (req: Request) => number }): RequestHandler {
  return (req, res, next) => {
    const key = opts.key(req);
    if (key === null) return next();
    const cost = opts.cost ? opts.cost(req) : 1;
    let d;
    try {
      d = limiter.take(key, cost);
    } catch (err) {
      if (err instanceof RangeError) return void res.status(400).json({ error: 'cost_exceeds_capacity' });
      throw err;
    }
    res.set('RateLimit-Limit', String(d.limit));
    res.set('RateLimit-Remaining', String(d.remaining));
    res.set('RateLimit-Reset', String(Math.ceil(d.resetMs / 1000)));
    if (!d.allowed) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(d.retryAfterMs / 1000))));
      return void res.status(429).json({ error: 'rate_limited', retryAfterMs: d.retryAfterMs });
    }
    next();
  };
}

export function createApp(deps: { limiter: Limiter }) {
  const app = express();
  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => {
    if (!req.get('X-Api-Key')) return void res.status(401).json({ error: 'api_key_required' });
    next();
  });
  const limit = (cost: number) => rateLimit(deps.limiter, { key: (req) => req.get('X-Api-Key') ?? null, cost: () => cost });
  app.get('/api/items', limit(1), (_req, res) => {
    res.json({ items: [] });
  });
  app.post('/api/reports', limit(5), (_req, res) => {
    res.status(202).json({ queued: true });
  });
  return app;
}
