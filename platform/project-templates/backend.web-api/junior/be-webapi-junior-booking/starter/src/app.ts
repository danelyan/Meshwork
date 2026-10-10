// Точка входа по контракту (contract.md): верните приложение Express или обработчик node:http.
import express from 'express';

export function createApp() {
  const app = express();
  app.use(express.json());
  // TODO: маршруты /appointments по контракту
  app.use((_req, res) => {
    res.status(501).json({ error: 'not_implemented' });
  });
  return app;
}
