import { createLlmClient, type AgentRunRecord } from '@/server/llm/client';
import { LlmError, type CompleteRequest, type CompleteResult, type LlmProvider } from '@/server/llm/types';

const req: CompleteRequest = { purpose: 'smoke', system: 's', messages: [{ role: 'user', content: 'hi' }] };

const okResult = (): CompleteResult => ({
  kind: 'text',
  text: 'ok',
  usage: { inputTokens: 3, outputTokens: 2 },
  latencyMs: 1,
  provider: 'fake',
  model: 'fake-1',
});

function fakeProvider(impl: (req: CompleteRequest, signal?: AbortSignal) => Promise<CompleteResult>): LlmProvider {
  return { name: 'fake', model: 'fake-1', supportsTools: true, supportsJsonSchema: true, complete: impl };
}

function setup(provider: LlmProvider, over: { maxConcurrency?: number; timeoutMs?: number; maxRetries?: number } = {}) {
  const runs: AgentRunRecord[] = [];
  const client = createLlmClient({
    provider,
    maxConcurrency: over.maxConcurrency ?? 8,
    timeoutMs: over.timeoutMs ?? 1_000,
    maxRetries: over.maxRetries ?? 2,
    backoffMs: () => 0,
    recordRun: (r) => {
      runs.push(r);
    },
  });
  return { client, runs };
}

describe('llm client: семафор и очередь', () => {
  it('одновременно выполняется не больше maxConcurrency запросов', async () => {
    let inFlight = 0;
    let peak = 0;
    const provider = fakeProvider(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 15));
      inFlight--;
      return okResult();
    });
    const { client, runs } = setup(provider, { maxConcurrency: 3 });
    const llm = client.forContext();
    await Promise.all(Array.from({ length: 10 }, () => llm.complete(req)));
    expect(peak).toBe(3);
    expect(runs).toHaveLength(10);
    expect(runs.every((r) => r.ok)).toBe(true);
  });

  it('сообщает позицию в очереди через onQueue и пишет время ожидания', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const provider = fakeProvider(async () => {
      await gate;
      return okResult();
    });
    const { client, runs } = setup(provider, { maxConcurrency: 1 });
    const first = client.forContext().complete(req);
    const positions: number[] = [];
    const second = client.forContext({ onQueue: (p) => positions.push(p) }).complete(req);
    const thirdPositions: number[] = [];
    const third = client.forContext({ onQueue: (p) => thirdPositions.push(p) }).complete(req);
    await new Promise((r) => setTimeout(r, 5));
    expect(positions).toEqual([1]);
    expect(thirdPositions).toEqual([2]);
    release();
    await Promise.all([first, second, third]);
    expect(thirdPositions).toEqual([2, 1]);
    expect(runs.map((r) => r.queueWaitMs).some((ms) => ms > 0)).toBe(true);
  });
});

describe('llm client: таймаут', () => {
  it('провайдер, игнорирующий сигнал, не вешает запрос: LlmError timeout без ретраев', async () => {
    let calls = 0;
    let sawAbort = false;
    const provider = fakeProvider((_r, signal) => {
      calls++;
      signal?.addEventListener('abort', () => (sawAbort = true));
      return new Promise(() => {});
    });
    const { client, runs } = setup(provider, { timeoutMs: 30 });
    await expect(client.forContext().complete(req)).rejects.toMatchObject({ name: 'LlmError', code: 'timeout' });
    expect(calls).toBe(1);
    expect(sawAbort).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ ok: false, attempts: 1 });
    expect(runs[0]?.error).toMatch(/30 мс/);
  });

  it('timeoutMs из запроса важнее значения по умолчанию', async () => {
    const provider = fakeProvider(() => new Promise(() => {}));
    const { client } = setup(provider, { timeoutMs: 60_000 });
    const started = Date.now();
    await expect(client.forContext().complete({ ...req, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('слот освобождается после таймаута', async () => {
    const provider = fakeProvider(() => new Promise(() => {}));
    const { client } = setup(provider, { timeoutMs: 10, maxConcurrency: 1 });
    await expect(client.forContext().complete(req)).rejects.toBeInstanceOf(LlmError);
    expect(client.semaphore.running).toBe(0);
  });
});

describe('llm client: ретраи', () => {
  it('429 дважды, потом успех → 3 попытки, одна запись ok', async () => {
    let calls = 0;
    const provider = fakeProvider(async () => {
      calls++;
      if (calls <= 2) throw new LlmError('rate_limited', 'slow down', 429);
      return okResult();
    });
    const { client, runs } = setup(provider);
    const res = await client.forContext().complete(req);
    expect(res.text).toBe('ok');
    expect(calls).toBe(3);
    expect(runs).toEqual([expect.objectContaining({ ok: true, attempts: 3 })]);
  });

  it('5xx три раза → ошибка после 1 + 2 ретраев', async () => {
    let calls = 0;
    // как APIError из SDK openai: обычная ошибка со status
    const provider = fakeProvider(async () => {
      calls++;
      throw Object.assign(new Error('bad gateway'), { status: 502 });
    });
    const { client, runs } = setup(provider);
    await expect(client.forContext().complete(req)).rejects.toMatchObject({ name: 'LlmError', status: 502 });
    expect(calls).toBe(3);
    expect(runs).toEqual([expect.objectContaining({ ok: false, attempts: 3, error: '[502] bad gateway' })]);
  });

  it('400 не ретраится', async () => {
    let calls = 0;
    const provider = fakeProvider(async () => {
      calls++;
      throw new LlmError('bad_request', 'bad schema', 400);
    });
    const { client } = setup(provider);
    await expect(client.forContext().complete(req)).rejects.toMatchObject({ code: 'bad_request' });
    expect(calls).toBe(1);
  });

  it('отмена внешним сигналом не ретраится', async () => {
    let calls = 0;
    const provider = fakeProvider((_r, signal) => {
      calls++;
      return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));
    });
    const { client } = setup(provider);
    const ctrl = new AbortController();
    const p = client.forContext().complete(req, ctrl.signal);
    setTimeout(() => ctrl.abort(), 5);
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(calls).toBe(1);
  });
});

describe('llm client: журнал AgentRun', () => {
  it('пишет purpose, провайдера, токены, контекст и jsonValid', async () => {
    const provider = fakeProvider(async () => ({ ...okResult(), kind: 'json', text: undefined, json: { a: 1 } }));
    const { client, runs } = setup(provider);
    await client
      .forContext({ candidateId: 'cand1', conversationId: 'conv1' })
      .complete({ ...req, purpose: 'extractor', schema: { name: 'x', jsonSchema: { type: 'object' } } });
    expect(runs[0]).toMatchObject({
      purpose: 'extractor',
      provider: 'fake',
      model: 'fake-1',
      inputTokens: 3,
      outputTokens: 2,
      ok: true,
      jsonValid: true,
      error: null,
      attempts: 1,
      candidateId: 'cand1',
      conversationId: 'conv1',
    });
  });

  it('без schema jsonValid = null; запрошен JSON, пришёл текст → false', async () => {
    const { client, runs } = setup(fakeProvider(async () => okResult()));
    await client.forContext().complete(req);
    await client.forContext().complete({ ...req, schema: { name: 'x', jsonSchema: {} } });
    expect(runs.map((r) => r.jsonValid)).toEqual([null, false]);
  });

  it('падение записи журнала не ломает ответ', async () => {
    const client = createLlmClient({
      provider: fakeProvider(async () => okResult()),
      maxConcurrency: 1,
      timeoutMs: 1000,
      maxRetries: 0,
      recordRun: () => {
        throw new Error('db down');
      },
    });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(client.forContext().complete(req)).resolves.toMatchObject({ text: 'ok' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
