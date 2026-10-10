// Middleware и приложение по контракту (contract.md).
import express, { type RequestHandler, type Request } from 'express';

import type { Limiter } from './limiter';

export function rateLimit(limiter: Limiter, opts: { key: (req: Request) => string | null; cost?: (req: Request) => number }): RequestHandler {
  void limiter;
  void opts;
  return (_req, res) => {
    res.status(501).json({ error: 'not_implemented' });
  };
}

export function createApp(deps: { limiter: Limiter }) {
  void deps;
  const app = express();
  app.use((_req, res) => {
    res.status(501).json({ error: 'not_implemented' });
  });
  return app;
}
