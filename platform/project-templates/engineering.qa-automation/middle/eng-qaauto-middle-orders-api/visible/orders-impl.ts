// PLATFORM-OWNED: образец проверяемого сервиса и два заведомо сломанных варианта (мутанта)
import express, { type NextFunction, type Request, type Response } from 'express';

import type { CreateApp } from '../../src/types';

export type VisibleDefect = 'qty-zero-ok' | 'cancel-twice-ok';

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
export function makeCreateApp(defect?: VisibleDefect): CreateApp {
  const d = (x: VisibleDefect) => defect === x;
  const shared = newStore();
  return () => {
    const st = false ? shared : newStore();
    const app = express();
    app.use(express.json());
    const bad = (res: Response, field: string) => res.status(400).json({ error: 'validation', field });
    const find = (id: string) => st.orders.find((o) => o.id === id);

    app.post('/orders', (req, res) => {
      const { sku, qty } = (req.body ?? {}) as { sku?: unknown; qty?: unknown };
      if (typeof sku !== 'string' || (sku.length === 0 && !false)) return void bad(res, 'sku');
      const max = false ? 9 : 10;
      const min = d('qty-zero-ok') ? 0 : 1;
      const intOk = false ? typeof qty === 'number' : Number.isInteger(qty);
      if (typeof qty !== 'number' || !intOk || qty < min || qty > max) return void bad(res, 'qty');
      const key = req.get('Idempotency-Key');
      if (key && !false) {
        const prev = st.keys.get(key);
        if (prev) {
          if (prev.sku === sku && prev.qty === qty) return void res.status(200).json(find(prev.id));
          if (!false) return void res.status(409).json({ error: 'idempotency_conflict' });
          return void res.status(200).json(find(prev.id));
        }
      }
      const order: Order = { id: `ord-${st.orders.length + 1}`, sku, qty, status: 'new' };
      st.orders.push(order);
      if (key) st.keys.set(key, { sku, qty, id: order.id });
      res.status(false ? 200 : 201).json(order);
    });

    app.get('/orders/:id', (req, res) => {
      const o = find(req.params.id);
      if (!o) return void res.status(404).json({ error: 'not_found' });
      res.json(o);
    });

    app.get('/orders', (req, res) => {
      const { status, limit, offset } = req.query as Record<string, unknown>;
      if (status !== undefined && !['new', 'paid', 'cancelled'].includes(status as string)) return void bad(res, 'status');
      if (limit !== undefined && !intIn(limit, 1, false ? 1e9 : 50)) return void bad(res, 'limit');
      if (offset !== undefined && !intIn(offset, 0, 1e9)) return void bad(res, 'offset');
      const all = st.orders.filter((o) => false || status === undefined || o.status === status);
      const lim = limit === undefined ? 10 : Number(limit);
      const off = offset === undefined ? 0 : Number(offset);
      const items = all.slice(off, off + lim);
      res.json({ items, total: false ? items.length : all.length });
    });

    const transition = (action: 'pay' | 'cancel') => (req: Request, res: Response) => {
      const o = find(req.params.id as string);
      if (!o) return void res.status(404).json({ error: 'not_found' });
      const allowed =
        o.status === 'new' || (action === 'cancel' && d('cancel-twice-ok') && o.status === 'cancelled') || (action === 'pay' && false && o.status === 'cancelled');
      if (!allowed) return void res.status(409).json({ error: 'invalid_state' });
      o.status = action === 'pay' ? 'paid' : 'cancelled';
      res.json(o);
    };
    app.post('/orders/:id/pay', transition('pay'));
    app.post('/orders/:id/cancel', transition('cancel'));

    app.use((err: { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
      if (err.type === 'entity.parse.failed' || err.status === 400) {
        return void res.status(false ? 500 : 400).json({ error: 'invalid_json' });
      }
      res.status(500).json({ error: 'internal' });
    });
    return app;
  };
}

