// Эталонное решение (кандидату не выдаётся).
import { DeliveryError } from './errors';

export { DeliveryError };

export interface DeliveryClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const AMOUNT = /^\d+(\.\d{1,2})?$/;
const RETRY_AFTER_CAP_MS = 5000;

function toKop(amount: string): number {
  const [rub, frac = ''] = amount.split('.');
  return Number(rub) * 100 + Number(frac.padEnd(2, '0'));
}

class Retryable extends Error {
  constructor(
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super('retryable');
  }
}

export function createDeliveryClient(options: DeliveryClientOptions) {
  const base = options.baseUrl.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 2000;
  const maxRetries = options.maxRetries ?? 3;
  const backoffMs = options.backoffMs ?? 100;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  async function attempt(path: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Retryable();
    }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'));
      await res.body?.cancel().catch(() => undefined);
      const hasRa = (res.status === 429 || res.status === 503) && res.headers.get('retry-after') !== null && Number.isFinite(ra) && ra >= 0;
      throw new Retryable(res.status, hasRa ? Math.min(ra * 1000, RETRY_AFTER_CAP_MS) : undefined);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      json = undefined;
    }
    if (res.status === 404) throw new DeliveryError('not_found', 'Провайдер: не найдено', { status: 404 });
    if (res.status >= 400) throw new DeliveryError('bad_request', `Провайдер отклонил запрос (${res.status})`, { status: res.status });
    return { status: res.status, json };
  }

  async function call(path: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
    let lastStatus: number | undefined;
    for (let n = 0; ; n++) {
      try {
        return (await attempt(path, body, headers)).json;
      } catch (e) {
        if (!(e instanceof Retryable)) throw e;
        lastStatus = e.status;
        if (n >= maxRetries) throw new DeliveryError('unavailable', 'Провайдер недоступен', { status: lastStatus, attempts: n + 1 });
        await sleep(e.retryAfterMs ?? backoffMs * 2 ** n);
      }
    }
  }

  const invalid = () => new DeliveryError('invalid_response', 'Провайдер вернул ответ не по контракту');

  return {
    async quote(req: { fromCity: string; toCity: string; weightKg: number }) {
      const json = (await call('/v2/quotes', { from_city: req.fromCity, to_city: req.toCity, weight_grams: Math.round(req.weightKg * 1000) })) as {
        price?: { amount?: unknown; currency?: unknown };
        eta?: { min_days?: unknown; max_days?: unknown };
      };
      const amount = json?.price?.amount;
      const min = json?.eta?.min_days;
      const max = json?.eta?.max_days;
      if (typeof amount !== 'string' || !AMOUNT.test(amount) || json.price?.currency !== 'RUB') throw invalid();
      if (!Number.isInteger(min) || !Number.isInteger(max) || (min as number) > (max as number)) throw invalid();
      return { priceKop: toKop(amount), etaDays: { min: min as number, max: max as number } };
    },
    async createShipment(req: { quoteId: string; recipient: string }, idempotencyKey: string) {
      const json = (await call('/v2/shipments', { quote_id: req.quoteId, recipient: req.recipient }, { 'idempotency-key': idempotencyKey })) as {
        shipment_id?: unknown;
        status?: unknown;
      };
      const status = json?.status === 'CREATED' ? 'created' : json?.status === 'PENDING' ? 'pending' : null;
      if (typeof json?.shipment_id !== 'string' || !status) throw invalid();
      return { shipmentId: json.shipment_id, status } as const;
    },
  };
}
