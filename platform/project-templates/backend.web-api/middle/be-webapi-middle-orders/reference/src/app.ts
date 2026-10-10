// Эталонное решение (кандидату не выдаётся).
import { randomUUID } from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';

import { createDb, type Db } from './db';

interface Item {
  sku: string;
  qty: number;
  priceKop: number;
}
interface Order {
  id: string;
  seq: number;
  customerId: string;
  items: Item[];
  totalKop: number;
  status: 'new' | 'paid' | 'shipped' | 'cancelled';
  version: number;
  createdAt: string;
}
interface IdemRecord {
  fingerprint: string;
  status: number;
  body: unknown;
}

const KEY = /^[A-Za-z0-9_-]{1,64}$/;
const NEXT: Record<string, string[]> = { new: ['paid', 'cancelled'], paid: ['shipped', 'cancelled'], shipped: [], cancelled: [] };
const STATUSES = Object.keys(NEXT);

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

const isInt = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function validate(b: Record<string, unknown>): string[] {
  const bad: string[] = [];
  if (typeof b.customerId !== 'string' || !b.customerId.trim()) bad.push('customerId');
  const items = b.items;
  const okItems =
    Array.isArray(items) &&
    items.length >= 1 &&
    items.length <= 50 &&
    items.every((i) => i && typeof i === 'object' && typeof i.sku === 'string' && i.sku.trim() && isInt(i.qty, 1, 100) && isInt(i.priceKop, 0));
  if (!okItems) bad.push('items');
  return bad.sort();
}

const view = ({ seq: _seq, ...o }: Order) => (void _seq, o);

/** Последовательный замок по ключу: асинхронное хранилище чередует параллельные запросы. */
function keyedLock() {
  const tails = new Map<string, Promise<unknown>>();
  return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

export function createApp(db: Db = createDb()) {
  const app = express();
  const lock = keyedLock();
  let seq = 0;
  app.use(express.json({ strict: false }));

  app.post('/orders', async (req, res) => {
    const key = req.get('idempotency-key');
    if (!key || !KEY.test(key)) return res.status(400).json({ error: 'idempotency_key_required' });
    const fingerprint = canonical(req.body);
    const out = await lock(`idem:${key}`, async () => {
      const prev = await db.get<IdemRecord>('idempotency', key);
      if (prev) return prev.fingerprint === fingerprint ? { ...prev, replay: true } : { status: 422, body: { error: 'idempotency_mismatch' }, replay: false };
      const b = req.body;
      let result: { status: number; body: unknown };
      if (!b || typeof b !== 'object' || Array.isArray(b)) result = { status: 400, body: { error: 'validation', fields: [] } };
      else {
        const fields = validate(b);
        if (fields.length) result = { status: 400, body: { error: 'validation', fields } };
        else {
          const items: Item[] = b.items.map((i: Item) => ({ sku: i.sku, qty: i.qty, priceKop: i.priceKop }));
          const order: Order = {
            id: randomUUID(),
            seq: ++seq,
            customerId: b.customerId,
            items,
            totalKop: items.reduce((s, i) => s + i.qty * i.priceKop, 0),
            status: 'new',
            version: 1,
            createdAt: new Date().toISOString(),
          };
          await db.put('orders', order.id, order);
          result = { status: 201, body: view(order) };
        }
      }
      if (result.status === 201) await db.put<IdemRecord>('idempotency', key, { fingerprint, ...result });
      return { ...result, replay: false };
    });
    if (out.replay) res.set('Idempotent-Replayed', 'true');
    return res.status(out.status).json(out.body);
  });

  app.get('/orders', async (req, res) => {
    const rawLimit = req.query.limit;
    let limit = 20;
    if (rawLimit !== undefined) {
      limit = Number(rawLimit);
      if (typeof rawLimit !== 'string' || !/^\d+$/.test(rawLimit) || limit < 1 || limit > 100) return res.status(400).json({ error: 'validation', fields: ['limit'] });
    }
    let after = 0;
    if (req.query.cursor !== undefined) {
      const raw = typeof req.query.cursor === 'string' ? Buffer.from(req.query.cursor, 'base64url').toString('utf8') : '';
      const m = /^seq:(\d+)$/.exec(raw);
      if (!m) return res.status(400).json({ error: 'invalid_cursor' });
      after = Number(m[1]);
    }
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const all = (await db.list<Order>('orders')).filter((o) => o.seq > after && (!status || o.status === status)).sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, limit);
    const nextCursor = all.length > limit ? Buffer.from(`seq:${page[page.length - 1]!.seq}`).toString('base64url') : null;
    return res.json({ items: page.map(view), nextCursor });
  });

  app.get('/orders/:id', async (req, res) => {
    const o = await db.get<Order>('orders', req.params.id);
    if (!o) return res.status(404).json({ error: 'not_found' });
    return res.set('ETag', `"${o.version}"`).json(view(o));
  });

  app.patch('/orders/:id', async (req, res) => {
    const id = req.params.id;
    const out = await lock(`order:${id}`, async () => {
      const o = await db.get<Order>('orders', id);
      if (!o) return { status: 404, body: { error: 'not_found' } };
      const status = req.body?.status;
      if (typeof status !== 'string' || !STATUSES.includes(status)) return { status: 400, body: { error: 'validation', fields: ['status'] } };
      const ifMatch = req.get('if-match');
      if (!ifMatch) return { status: 428, body: { error: 'precondition_required' } };
      if (ifMatch.replace(/^W\//, '').replace(/"/g, '').trim() !== String(o.version)) return { status: 412, body: { error: 'version_conflict' } };
      if (!NEXT[o.status]!.includes(status)) return { status: 409, body: { error: 'invalid_transition' } };
      const next: Order = { ...o, status: status as Order['status'], version: o.version + 1 };
      await db.put('orders', id, next);
      return { status: 200, body: view(next), etag: `"${next.version}"` };
    });
    if ('etag' in out && out.etag) res.set('ETag', out.etag);
    return res.status(out.status).json(out.body);
  });

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found' });
  });
  app.use((err: { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    res.status(err.status === 400 ? 400 : 500).json(err.status === 400 ? { error: 'validation', fields: [] } : { error: 'internal' });
  });
  return app;
}
