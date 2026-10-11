// Эталон: HTTP поверх батчера.
import express from 'express';

import { KeyNotFoundError, type Batcher } from './batcher';

export interface Item {
  id: string;
  name: string;
}

export function createApp(deps: { batcher: Batcher<Item> }) {
  const app = express();

  app.get('/items', async (req, res) => {
    const raw = typeof req.query.ids === 'string' ? req.query.ids : '';
    const ids = [...new Set(raw.split(',').filter(Boolean))];
    if (ids.length === 0) return void res.status(400).json({ error: 'ids_required' });
    const settled = await Promise.allSettled(ids.map((id) => deps.batcher.load(id)));
    const items: Item[] = [];
    const missing: string[] = [];
    for (const [i, s] of settled.entries()) {
      if (s.status === 'fulfilled') items.push(s.value);
      else if (s.reason instanceof KeyNotFoundError) missing.push(ids[i]!);
      else return void res.status(502).json({ error: 'upstream_failed' });
    }
    res.json({ items, missing });
  });

  app.get('/items/:id', async (req, res) => {
    try {
      res.json(await deps.batcher.load(req.params.id));
    } catch (err) {
      if (err instanceof KeyNotFoundError) return void res.status(404).json({ error: 'not_found' });
      res.status(502).json({ error: 'upstream_failed' });
    }
  });

  return app;
}
