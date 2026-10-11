// Приём вебхука по контракту (contract.md).
import express from 'express';

export interface WebhookEvent {
  id: string;
  type: string;
  data?: unknown;
}

export interface WebhookOptions {
  secret: string;
  now?: () => number;
  toleranceSec?: number;
  onEvent?: (event: WebhookEvent) => void | Promise<void>;
}

export function sign(secret: string, timestamp: string, rawBody: string): string {
  void secret;
  void timestamp;
  void rawBody;
  throw new Error('not implemented');
}

export function createApp(options: WebhookOptions) {
  void options;
  const app = express();
  // TODO: POST /webhooks/payments по контракту
  app.use((_req, res) => {
    res.status(501).json({ error: 'not_implemented' });
  });
  return app;
}
