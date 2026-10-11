// Точка входа по контракту (contract.md).
import express from 'express';

import { createDb, type Db } from './db';

export function createApp(db: Db = createDb()) {
  void db;
  const app = express();
  app.use(express.json());
  // TODO: /orders по контракту – идемпотентность, пагинация, версии
  app.use((_req, res) => {
    res.status(501).json({ error: 'not_implemented' });
  });
  return app;
}
