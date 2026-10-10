// Эталонное решение (кандидату не выдаётся): проверка скрытых тестов шаблона.
import { randomUUID } from 'node:crypto';

import express, { type NextFunction, type Request, type Response } from 'express';

interface Appointment {
  id: string;
  clientName: string;
  specialistId: string;
  startsAt: string;
  durationMin: number;
  status: 'booked' | 'cancelled';
}

const TZ_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validate(b: Record<string, unknown>): string[] {
  const bad: string[] = [];
  const name = typeof b.clientName === 'string' ? b.clientName.trim() : '';
  if (name.length < 1 || name.length > 100) bad.push('clientName');
  const d = b.durationMin;
  if (typeof d !== 'number' || !Number.isInteger(d) || d < 15 || d > 240 || d % 15 !== 0) bad.push('durationMin');
  if (typeof b.specialistId !== 'string' || !b.specialistId.trim()) bad.push('specialistId');
  if (typeof b.startsAt !== 'string' || !TZ_DATETIME.test(b.startsAt) || Number.isNaN(Date.parse(b.startsAt))) bad.push('startsAt');
  return bad.sort();
}

export function createApp() {
  const store = new Map<string, Appointment>();
  const app = express();
  app.use(express.json({ strict: false }));

  const end = (a: Appointment) => Date.parse(a.startsAt) + a.durationMin * 60_000;

  app.post('/appointments', (req, res) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'validation', fields: [] });
    const fields = validate(b);
    if (fields.length) return res.status(400).json({ error: 'validation', fields });
    const appt: Appointment = {
      id: randomUUID(),
      clientName: b.clientName.trim(),
      specialistId: b.specialistId,
      startsAt: new Date(b.startsAt).toISOString(),
      durationMin: b.durationMin,
      status: 'booked',
    };
    const s = Date.parse(appt.startsAt);
    const e = end(appt);
    for (const o of store.values()) {
      if (o.specialistId !== appt.specialistId || o.status !== 'booked') continue;
      if (s < end(o) && Date.parse(o.startsAt) < e) return res.status(409).json({ error: 'slot_taken' });
    }
    store.set(appt.id, appt);
    return res.status(201).json(appt);
  });

  app.get('/appointments', (req, res) => {
    const specialistId = typeof req.query.specialistId === 'string' ? req.query.specialistId : '';
    if (!specialistId) return res.status(400).json({ error: 'validation', fields: ['specialistId'] });
    const date = req.query.date;
    if (date !== undefined && (typeof date !== 'string' || !DATE.test(date))) return res.status(400).json({ error: 'validation', fields: ['date'] });
    const items = [...store.values()]
      .filter((a) => a.specialistId === specialistId && (!date || a.startsAt.slice(0, 10) === date))
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
    return res.json({ items });
  });

  app.get('/appointments/:id', (req, res) => {
    const a = store.get(req.params.id);
    return a ? res.json(a) : res.status(404).json({ error: 'not_found' });
  });

  app.post('/appointments/:id/cancel', (req, res) => {
    const a = store.get(req.params.id);
    if (!a) return res.status(404).json({ error: 'not_found' });
    if (a.status === 'cancelled') return res.status(409).json({ error: 'already_cancelled' });
    a.status = 'cancelled';
    return res.json(a);
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
