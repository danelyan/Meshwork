// Эталон: маскирование ПДн, фолбэк провайдеров, бюджет до вызова, проверка и один ремонт, кэш с дедупликацией.
import { ProviderError, type Provider, type ProviderResponse } from './provider';

export interface Field {
  name: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
}

export interface ExtractRequest {
  instruction: string;
  text: string;
  fields: Field[];
}

export type Value = string | number | boolean | null;

export interface ExtractResult {
  data: Record<string, Value>;
  provider: string;
  cached: boolean;
  repaired: boolean;
  tokens: number;
}

export type GatewayErrorCode = 'bad_request' | 'budget_exceeded' | 'provider_rejected' | 'all_providers_failed' | 'invalid_output';

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface Gateway {
  extract(req: ExtractRequest): Promise<ExtractResult>;
  spent(): number;
}

const NAME = /^[a-z][a-zA-Z0-9_]*$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+7|\b8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/g;

function mask(text: string): { text: string; back: Map<string, string> } {
  const back = new Map<string, string>();
  const seen = new Map<string, string>();
  let n = { EMAIL: 0, PHONE: 0 };
  const sub = (kind: 'EMAIL' | 'PHONE') => (m: string) => {
    const known = seen.get(m);
    if (known) return known;
    n = { ...n, [kind]: n[kind] + 1 };
    const ph = `[${kind}_${n[kind]}]`;
    seen.set(m, ph);
    back.set(ph, m);
    return ph;
  };
  return { text: text.replace(EMAIL, sub('EMAIL')).replace(PHONE, sub('PHONE')), back };
}

function parse(raw: string, fields: Field[]): { ok: true; data: Record<string, Value> } | { ok: false; error: string } {
  const a = raw.indexOf('{');
  const b = raw.lastIndexOf('}');
  if (a < 0 || b < a) return { ok: false, error: 'в ответе нет JSON-объекта' };
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(a, b + 1));
  } catch {
    return { ok: false, error: 'ответ — невалидный JSON' };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'нужен JSON-объект' };
  const src = obj as Record<string, unknown>;
  const data: Record<string, Value> = {};
  for (const f of fields) {
    const v = src[f.name];
    if (v === undefined || v === null) {
      if (f.required) return { ok: false, error: `нет обязательного поля ${f.name}` };
      data[f.name] = null;
      continue;
    }
    const good = f.type === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeof v === f.type;
    if (!good) return { ok: false, error: `поле ${f.name} должно быть типа ${f.type}` };
    data[f.name] = v as Value;
  }
  return { ok: true, data };
}

function unmask(data: Record<string, Value>, back: Map<string, string>): Record<string, Value> {
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(data)) out[k] = typeof v === 'string' ? v.replace(/\[(?:EMAIL|PHONE)_\d+\]/g, (ph) => back.get(ph) ?? ph) : v;
  return out;
}

export function createGateway(options: { providers: Provider[]; budgetTokens: number; maxTokens?: number }): Gateway {
  const maxTokens = options.maxTokens ?? 512;
  let spent = 0;
  const cache = new Map<string, ExtractResult>();
  const inflight = new Map<string, Promise<ExtractResult>>();

  async function call(p: Provider, system: string, user: string): Promise<ProviderResponse> {
    const estimate = Math.ceil((system.length + user.length) / 4) + maxTokens;
    if (spent + estimate > options.budgetTokens) throw new GatewayError('budget_exceeded');
    const res = await p.complete({ system, user, maxTokens });
    spent += res.inputTokens + res.outputTokens;
    return res;
  }

  async function run(req: ExtractRequest): Promise<ExtractResult> {
    const { text, back } = mask(req.text);
    const schema = req.fields.map((f) => `"${f.name}": ${f.type}${f.required ? '' : ' | null'}`).join(', ');
    const system = `Извлеки данные из текста. ${req.instruction}\nВерни только JSON-объект: { ${schema} }. Плейсхолдеры вида [EMAIL_1] переноси как есть.`;
    const user = `<text>\n${text}\n</text>`;
    const before = spent;
    for (const p of options.providers) {
      let first: ProviderResponse;
      try {
        first = await call(p, system, user);
      } catch (err) {
        if (err instanceof ProviderError && (err.kind === 'timeout' || err.kind === 'rate_limit' || err.kind === 'server')) continue;
        if (err instanceof ProviderError) throw new GatewayError('provider_rejected', err.message);
        throw err;
      }
      let parsed = parse(first.text, req.fields);
      let repaired = false;
      if (!parsed.ok) {
        const fix = `${user}\n\nПрошлый ответ:\n${first.text}\n\nОшибка: ${parsed.error}. Верни исправленный JSON-объект.`;
        const second = await call(p, system, fix);
        parsed = parse(second.text, req.fields);
        if (!parsed.ok) throw new GatewayError('invalid_output', parsed.error);
        repaired = true;
      }
      return { data: unmask(parsed.data, back), provider: p.name, cached: false, repaired, tokens: spent - before };
    }
    throw new GatewayError('all_providers_failed');
  }

  return {
    async extract(req) {
      if (!req.text.trim() || !req.fields.length) throw new GatewayError('bad_request');
      const names = new Set<string>();
      for (const f of req.fields) {
        if (!NAME.test(f.name) || names.has(f.name)) throw new GatewayError('bad_request', `поле ${f.name}`);
        names.add(f.name);
      }
      const key = JSON.stringify([req.instruction, req.text, req.fields.map((f) => [f.name, f.type, f.required])]);
      const hit = cache.get(key);
      if (hit) return { ...hit, data: { ...hit.data }, cached: true, tokens: 0 };
      const pending = inflight.get(key);
      if (pending) return pending.then((r) => ({ ...r, data: { ...r.data } }));
      const p = run(req)
        .then((r) => {
          cache.set(key, r);
          return r;
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p.then((r) => ({ ...r, data: { ...r.data } }));
    },
    spent: () => spent,
  };
}
