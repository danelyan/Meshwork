import { createHmac, timingSafeEqual } from 'node:crypto';

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

const KNOWN = new Set(['payment.succeeded', 'payment.failed', 'refund.created']);

export function sign(secret: string, timestamp: string, rawBody: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createApp(options: WebhookOptions) {
  const now = options.now ?? Date.now;
  const tolerance = options.toleranceSec ?? 300;
  const done = new Set<string>();
  const app = express();

  app.post('/webhooks/payments', express.raw({ type: () => true, limit: '1mb' }), async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
    const signature = req.header('x-signature');
    const ts = req.header('x-timestamp');
    if (!signature || !ts || !/^-?\d+$/.test(ts) || !safeEqual(signature, sign(options.secret, ts, raw))) {
      res.status(401).json({ error: 'invalid_signature' });
      return;
    }
    if (Math.abs(now() / 1000 - Number(ts)) > tolerance) {
      res.status(401).json({ error: 'stale_timestamp' });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }
    const b = body as Record<string, unknown> | null | undefined;
    if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.id !== 'string' || !b.id || typeof b.type !== 'string' || !b.type) {
      res.status(400).json({ error: 'invalid_payload' });
      return;
    }
    if (!KNOWN.has(b.type)) {
      res.status(200).json({ status: 'ignored' });
      return;
    }
    if (done.has(b.id)) {
      res.status(200).json({ status: 'duplicate' });
      return;
    }
    try {
      await options.onEvent?.({ id: b.id, type: b.type, data: b.data });
    } catch {
      res.status(500).json({ error: 'handler_failed' });
      return;
    }
    done.add(b.id);
    res.status(200).json({ status: 'processed' });
  });
  return app;
}
