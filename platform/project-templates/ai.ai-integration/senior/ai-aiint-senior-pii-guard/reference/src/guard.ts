// Эталонное решение.
import { ModelError, type Model } from './model';

export type PiiType = 'EMAIL' | 'PHONE' | 'CARD';

export interface AskRequest {
  userId: string;
  prompt: string;
}

export interface Answer {
  text: string;
  model: string;
  cached: boolean;
  tokens: number;
  masked: number;
}

export type GuardErrorCode = 'bad_request' | 'budget_exceeded' | 'model_rejected' | 'unavailable';

export class GuardError extends Error {
  constructor(
    public readonly code: GuardErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'GuardError';
  }
}

export interface Usage {
  used: number;
  limit: number;
  resetsAt: number;
}

export interface AuditEntry {
  userId: string;
  at: number;
  outcome: 'ok' | 'cached' | Exclude<GuardErrorCode, 'bad_request'>;
  model: string | null;
  tokens: number;
  pii: Partial<Record<PiiType, number>>;
}

export interface Guard {
  ask(req: AskRequest): Promise<Answer>;
  usage(userId: string): Usage;
  audit(): AuditEntry[];
}

export interface GuardOptions {
  primary: Model;
  fallback?: Model;
  now: () => number;
  budget: { tokens: number; periodMs: number };
  maxTokens?: number;
  cacheTtlMs?: number;
}

interface Masked {
  text: string;
  /** плейсхолдер -> исходное значение (первое написание) */
  table: Map<string, string>;
  pii: Partial<Record<PiiType, number>>;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CARD_RE = /(?<!\d)\d{4}(?:[ -]?)\d{4}(?:[ -]?)\d{4}(?:[ -]?)\d{4}(?!\d)/g;
const PHONE_RE = /(?<![\d+])(?:\+7|8)[ -]*\(?\d{3}\)?[ -]*\d{3}[ -]*\d{2}[ -]*\d{2}(?!\d)/g;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

function mask(prompt: string): Masked {
  const table = new Map<string, string>();
  const pii: Partial<Record<PiiType, number>> = {};
  let text = prompt;

  const pass = (type: PiiType, re: RegExp, key: (m: string) => string | null) => {
    const ids = new Map<string, string>();
    text = text.replace(re, (m) => {
      const k = key(m);
      if (k === null) return m;
      let ph = ids.get(k);
      if (!ph) {
        ph = `[${type}_${ids.size + 1}]`;
        ids.set(k, ph);
        table.set(ph, m);
        pii[type] = ids.size;
      }
      return ph;
    });
  };

  pass('EMAIL', EMAIL_RE, (m) => m.toLowerCase());
  pass('CARD', CARD_RE, (m) => {
    const d = m.replace(/\D/g, '');
    return luhn(d) ? d : null;
  });
  pass('PHONE', PHONE_RE, (m) => `7${m.replace(/\D/g, '').slice(-10)}`);
  return { text, table, pii };
}

function restore(text: string, table: Map<string, string>): string {
  return text.replace(/\[(?:EMAIL|CARD|PHONE)_\d+\]/g, (ph) => table.get(ph) ?? ph);
}

interface Done {
  maskedText: string;
  model: string;
  tokens: number;
}

export function createGuard(options: GuardOptions): Guard {
  const { primary, fallback, now, budget } = options;
  const maxTokens = options.maxTokens ?? 256;
  const ttl = options.cacheTtlMs ?? 300_000;
  const spent = new Map<string, number>(); // `${userId}|${window}` -> tokens
  const cache = new Map<string, { maskedText: string; model: string; storedAt: number }>();
  const inflight = new Map<string, Promise<Done>>();
  const log: AuditEntry[] = [];

  const slot = (userId: string, t: number) => `${userId}|${Math.floor(t / budget.periodMs)}`;

  async function callModels(prompt: string): Promise<{ text: string; model: string; tokens: number }> {
    const chain = fallback ? [primary, fallback] : [primary];
    for (const m of chain) {
      try {
        const r = await m.complete({ prompt, maxTokens });
        return { text: r.text, model: m.name, tokens: r.tokens };
      } catch (e) {
        const kind = e instanceof ModelError ? e.kind : 'server';
        if (kind === 'bad_request' || kind === 'auth') throw new GuardError('model_rejected');
      }
    }
    throw new GuardError('unavailable');
  }

  return {
    async ask(req) {
      const t = now();
      const userId = typeof req.userId === 'string' ? req.userId.trim() : '';
      if (!userId || typeof req.prompt !== 'string' || !req.prompt.trim()) throw new GuardError('bad_request');
      const m = mask(req.prompt);
      const masked = m.table.size;
      const record = (outcome: AuditEntry['outcome'], model: string | null, tokens: number) =>
        log.push({ userId: req.userId, at: t, outcome, model, tokens, pii: { ...m.pii } });
      const fail = (e: unknown): never => {
        if (e instanceof GuardError) record(e.code as AuditEntry['outcome'], null, 0);
        throw e;
      };

      const hit = cache.get(m.text);
      if (hit && t - hit.storedAt < ttl) {
        record('cached', null, 0);
        return { text: restore(hit.maskedText, m.table), model: hit.model, cached: true, tokens: 0, masked };
      }

      const running = inflight.get(m.text);
      if (running) {
        try {
          const d = await running;
          record('cached', null, 0);
          return { text: restore(d.maskedText, m.table), model: d.model, cached: true, tokens: 0, masked };
        } catch (e) {
          return fail(e);
        }
      }

      const key = slot(req.userId, t);
      const estimate = Math.ceil(m.text.length / 4) + maxTokens;
      if ((spent.get(key) ?? 0) + estimate > budget.tokens) return fail(new GuardError('budget_exceeded'));

      const job = callModels(m.text).then<Done>((r) => {
        spent.set(key, (spent.get(key) ?? 0) + r.tokens);
        cache.set(m.text, { maskedText: r.text, model: r.model, storedAt: t });
        return { maskedText: r.text, model: r.model, tokens: r.tokens };
      });
      inflight.set(m.text, job);
      try {
        const d = await job;
        record('ok', d.model, d.tokens);
        return { text: restore(d.maskedText, m.table), model: d.model, cached: false, tokens: d.tokens, masked };
      } catch (e) {
        return fail(e);
      } finally {
        inflight.delete(m.text);
      }
    },

    usage(userId) {
      const t = now();
      return {
        used: spent.get(slot(userId, t)) ?? 0,
        limit: budget.tokens,
        resetsAt: (Math.floor(t / budget.periodMs) + 1) * budget.periodMs,
      };
    },

    audit() {
      return log.map((e) => ({ ...e, pii: { ...e.pii } }));
    },
  };
}
