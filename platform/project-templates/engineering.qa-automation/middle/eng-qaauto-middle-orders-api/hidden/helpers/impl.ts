// PLATFORM-OWNED: эталонный сервис и мутанты скрытых тестов платформы; кандидату не выдаются
import express, { type NextFunction, type Request, type Response } from 'express';

import type { CreateApp } from '../../src/types';

export type Defect =
  | 'qty-zero-ok'
  | 'qty-max-strict'
  | 'qty-float-ok'
  | 'sku-empty-ok'
  | 'create-200'
  | 'idem-ignored'
  | 'idem-conflict-ignored'
  | 'cancel-twice-ok'
  | 'pay-cancelled-ok'
  | 'list-limit-no-cap'
  | 'list-total-page'
  | 'list-status-ignored'
  | 'bad-json-500'
  | 'state-shared';

interface Order {
  id: string;
  sku: string;
  qty: number;
  status: 'new' | 'paid' | 'cancelled';
}

interface Store {
  orders: Order[];
  keys: Map<string, { sku: string; qty: number; id: string }>;
}

const newStore = (): Store => ({ orders: [], keys: new Map() });
const intIn = (s: unknown, min: number, max: number) => typeof s === 'string' && /^\d+$/.test(s) && Number(s) >= min && Number(s) <= max;

/** Эталонный сервис; defect включает одно известное нарушение контракта. */
export function makeCreateApp(defect?: Defect): CreateApp {
  const d = (x: Defect) => defect === x;
  const shared = newStore();
  return () => {
    const st = d('state-shared') ? shared : newStore();
    const app = express();
    app.use(express.json());
    const bad = (res: Response, field: string) => res.status(400).json({ error: 'validation', field });
    const find = (id: string) => st.orders.find((o) => o.id === id);

    app.post('/orders', (req, res) => {
      const { sku, qty } = (req.body ?? {}) as { sku?: unknown; qty?: unknown };
      if (typeof sku !== 'string' || (sku.length === 0 && !d('sku-empty-ok'))) return void bad(res, 'sku');
      const max = d('qty-max-strict') ? 9 : 10;
      const min = d('qty-zero-ok') ? 0 : 1;
      const intOk = d('qty-float-ok') ? typeof qty === 'number' : Number.isInteger(qty);
      if (typeof qty !== 'number' || !intOk || qty < min || qty > max) return void bad(res, 'qty');
      const key = req.get('Idempotency-Key');
      if (key && !d('idem-ignored')) {
        const prev = st.keys.get(key);
        if (prev) {
          if (prev.sku === sku && prev.qty === qty) return void res.status(200).json(find(prev.id));
          if (!d('idem-conflict-ignored')) return void res.status(409).json({ error: 'idempotency_conflict' });
          return void res.status(200).json(find(prev.id));
        }
      }
      const order: Order = { id: `ord-${st.orders.length + 1}`, sku, qty, status: 'new' };
      st.orders.push(order);
      if (key) st.keys.set(key, { sku, qty, id: order.id });
      res.status(d('create-200') ? 200 : 201).json(order);
    });

    app.get('/orders/:id', (req, res) => {
      const o = find(req.params.id);
      if (!o) return void res.status(404).json({ error: 'not_found' });
      res.json(o);
    });

    app.get('/orders', (req, res) => {
      const { status, limit, offset } = req.query as Record<string, unknown>;
      if (status !== undefined && !['new', 'paid', 'cancelled'].includes(status as string)) return void bad(res, 'status');
      if (limit !== undefined && !intIn(limit, 1, d('list-limit-no-cap') ? 1e9 : 50)) return void bad(res, 'limit');
      if (offset !== undefined && !intIn(offset, 0, 1e9)) return void bad(res, 'offset');
      const all = st.orders.filter((o) => d('list-status-ignored') || status === undefined || o.status === status);
      const lim = limit === undefined ? 10 : Number(limit);
      const off = offset === undefined ? 0 : Number(offset);
      const items = all.slice(off, off + lim);
      res.json({ items, total: d('list-total-page') ? items.length : all.length });
    });

    const transition = (action: 'pay' | 'cancel') => (req: Request, res: Response) => {
      const o = find(req.params.id as string);
      if (!o) return void res.status(404).json({ error: 'not_found' });
      const allowed =
        o.status === 'new' || (action === 'cancel' && d('cancel-twice-ok') && o.status === 'cancelled') || (action === 'pay' && d('pay-cancelled-ok') && o.status === 'cancelled');
      if (!allowed) return void res.status(409).json({ error: 'invalid_state' });
      o.status = action === 'pay' ? 'paid' : 'cancelled';
      res.json(o);
    };
    app.post('/orders/:id/pay', transition('pay'));
    app.post('/orders/:id/cancel', transition('cancel'));

    app.use((err: { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
      if (err.type === 'entity.parse.failed' || err.status === 400) {
        return void res.status(d('bad-json-500') ? 500 : 400).json({ error: 'invalid_json' });
      }
      res.status(500).json({ error: 'internal' });
    });
    return app;
  };
}

/** Независимо написанный сервис с тем же поведением: другой формат id, другая структура кода. */
export const altCreateApp: CreateApp = () => {
  const byId = new Map<string, Order>();
  const idem = new Map<string, string>();
  let seq = 100;
  const app = express();
  app.use(express.json());
  const reject = (res: Response, code: number, body: object) => res.status(code).json(body);
  app.post('/orders', (req, res) => {
    const b = req.body;
    if (!b || typeof b.sku !== 'string' || !b.sku) return void reject(res, 400, { field: 'sku', error: 'validation' });
    if (!Number.isInteger(b.qty) || b.qty < 1 || b.qty > 10) return void reject(res, 400, { field: 'qty', error: 'validation' });
    const key = req.header('idempotency-key');
    if (key && idem.has(key)) {
      const prev = byId.get(idem.get(key)!)!;
      if (prev.sku !== b.sku || prev.qty !== b.qty) return void reject(res, 409, { error: 'idempotency_conflict' });
      return void reject(res, 200, prev);
    }
    const o: Order = { status: 'new', qty: b.qty, sku: b.sku, id: `x${seq++}` };
    byId.set(o.id, o);
    if (key) idem.set(key, o.id);
    reject(res, 201, o);
  });
  app.get('/orders/:id', (req, res) => {
    const o = byId.get(req.params.id);
    o ? res.json(o) : reject(res, 404, { error: 'not_found' });
  });
  app.get('/orders', (req, res) => {
    const q = req.query;
    const num = (v: unknown, def: number, lo: number, hi: number, field: string) => {
      if (v === undefined) return def;
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
      if (!Number.isInteger(n) || n < lo || n > hi) throw Object.assign(new Error(field), { field });
      return n;
    };
    try {
      if (q.status !== undefined && !/^(new|paid|cancelled)$/.test(String(q.status))) throw Object.assign(new Error('status'), { field: 'status' });
      const limit = num(q.limit, 10, 1, 50, 'limit');
      const offset = num(q.offset, 0, 0, Number.MAX_SAFE_INTEGER, 'offset');
      const rows = [...byId.values()].filter((o) => !q.status || o.status === q.status);
      res.json({ total: rows.length, items: rows.slice(offset, offset + limit) });
    } catch (e) {
      reject(res, 400, { error: 'validation', field: (e as { field: string }).field });
    }
  });
  for (const [action, to] of [['pay', 'paid'], ['cancel', 'cancelled']] as const) {
    app.post(`/orders/:id/${action}`, (req, res) => {
      const o = byId.get(req.params.id);
      if (!o) return void reject(res, 404, { error: 'not_found' });
      if (o.status !== 'new') return void reject(res, 409, { error: 'invalid_state' });
      o.status = to;
      res.json(o);
    });
  }
  app.use((_e: unknown, _q: Request, res: Response, _n: NextFunction) => reject(res, 400, { error: 'invalid_json' }));
  return app;
};
