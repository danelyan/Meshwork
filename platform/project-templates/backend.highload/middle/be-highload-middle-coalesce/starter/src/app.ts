// HTTP-слой по контракту (contract.md).
import express from 'express';

import type { Batcher } from './batcher';

export interface Item {
  id: string;
  name: string;
}

export function createApp(deps: { batcher: Batcher<Item> }) {
  void deps;
  const app = express();
  app.use((_req, res) => {
    res.status(501).json({ error: 'not_implemented' });
  });
  return app;
}
