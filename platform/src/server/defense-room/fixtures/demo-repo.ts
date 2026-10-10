import type { RepoSnapshot } from '../types';

/**
 * Демо-репозиторий для защиты без сети (тесты, демо-стенд): `https://github.com/fsp-demo/<любое имя>`.
 * Это вымышленный проект сида, не чужой код и не реальный репозиторий GitHub.
 */
export const DEMO_REPO_PREFIX = 'https://github.com/fsp-demo/';

export function isDemoRepo(url: string): boolean {
  return url.toLowerCase().startsWith(DEMO_REPO_PREFIX);
}

const RETRY_TS = `import { Queue } from './queue';
import type { Payment, Gateway } from './types';

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 200;

/** Повтор платежа с экспоненциальной задержкой и ключом идемпотентности. */
export async function chargeWithRetry(gateway: Gateway, payment: Payment, seen: Set<string>): Promise<'ok' | 'duplicate' | 'failed'> {
  if (seen.has(payment.idempotencyKey)) {
    return 'duplicate';
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await gateway.charge(payment);
      if (res.status === 'ok') {
        seen.add(payment.idempotencyKey);
        return 'ok';
      }
      if (res.status === 'declined') {
        return 'failed';
      }
    } catch (err) {
      if (attempt === MAX_ATTEMPTS) throw err;
    }
    const jitter = Math.floor(Math.random() * BASE_DELAY_MS);
    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + jitter);
  }
  return 'failed';
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
`;

const QUEUE_TS = `/** Очередь задач в памяти с ограничением параллельности. */
export class Queue<T> {
  private running = 0;
  private items: (() => Promise<T>)[] = [];

  constructor(private readonly concurrency: number) {}

  push(job: () => Promise<T>): void {
    this.items.push(job);
    this.drain();
  }

  private drain(): void {
    while (this.running < this.concurrency && this.items.length > 0) {
      const job = this.items.shift()!;
      this.running++;
      job()
        .catch((e) => console.error('job failed', e))
        .finally(() => {
          this.running--;
          this.drain();
        });
    }
  }
}
`;

const HANDLER_TS = `import { chargeWithRetry } from './retry';
import type { Gateway, Payment } from './types';

const seen = new Set<string>();

export async function handlePayment(gateway: Gateway, body: unknown): Promise<{ status: number; result: string }> {
  const payment = parse(body);
  if (!payment) {
    return { status: 400, result: 'bad request' };
  }
  const result = await chargeWithRetry(gateway, payment, seen);
  if (result === 'duplicate') {
    return { status: 200, result: 'already processed' };
  }
  return { status: result === 'ok' ? 201 : 402, result };
}

function parse(body: unknown): Payment | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.amount !== 'number' || b.amount <= 0) return null;
  if (typeof b.idempotencyKey !== 'string' || b.idempotencyKey.length < 8) return null;
  return { amount: b.amount, idempotencyKey: b.idempotencyKey, currency: String(b.currency ?? 'RUB') };
}
`;

const TYPES_TS = `export interface Payment { amount: number; currency: string; idempotencyKey: string }
export interface Gateway { charge(p: Payment): Promise<{ status: 'ok' | 'declined' | 'error' }> }
`;

export function demoRepoSnapshot(repoUrl: string): RepoSnapshot {
  const files = [
    { path: 'src/retry.ts', content: RETRY_TS },
    { path: 'src/queue.ts', content: QUEUE_TS },
    { path: 'src/handler.ts', content: HANDLER_TS },
    { path: 'src/types.ts', content: TYPES_TS },
  ].map((f) => ({ ...f, size: f.content.length }));
  return {
    repoUrl,
    commitSha: 'd3m0c0ffee0000000000000000000000000000aa',
    tree: ['README.md', 'package.json', ...files.map((f) => f.path), 'tests/retry.test.ts'],
    files,
    commits: [
      {
        sha: 'd3m0c0ffee0000000000000000000000000000aa',
        message: 'Add jitter to retry backoff',
        date: '2026-10-09T18:20:00Z',
        files: [{ path: 'src/retry.ts', patch: '@@ -20,7 +20,8 @@\n-    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));\n+    const jitter = Math.floor(Math.random() * BASE_DELAY_MS);\n+    await sleep(BASE_DELAY_MS * 2 ** (attempt - 1) + jitter);' }],
      },
      { sha: 'd3m0c0ffee0000000000000000000000000000bb', message: 'Idempotency key check before charge', date: '2026-10-09T16:02:00Z' },
      { sha: 'd3m0c0ffee0000000000000000000000000000cc', message: 'Initial payment handler', date: '2026-10-09T12:40:00Z' },
    ],
    truncated: { treeEntries: 0, files: 0 },
  };
}
