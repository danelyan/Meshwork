import { createLlmClient, FALLBACK_COOLDOWN_MS, type AgentRunRecord } from '@/server/llm/client';
import { LlmError, type CompleteRequest, type CompleteResult, type LlmProvider } from '@/server/llm/types';

const req: CompleteRequest = { purpose: 'smoke', system: 's', messages: [{ role: 'user', content: 'hi' }] };

const result = (provider: string): CompleteResult => ({
  kind: 'text',
  text: `от ${provider}`,
  usage: { inputTokens: 3, outputTokens: 2 },
  latencyMs: 1,
  provider,
  model: `${provider}-1`,
});

function provider(name: string, impl: (req: CompleteRequest, signal?: AbortSignal) => Promise<CompleteResult>): LlmProvider & { calls: number } {
  const p = {
    name,
    model: `${name}-1`,
    supportsTools: true,
    supportsJsonSchema: true,
    calls: 0,
    complete: (r: CompleteRequest, s?: AbortSignal) => {
      p.calls++;
      return impl(r, s);
    },
  };
  return p;
}

function setup(primary: LlmProvider, fallback: LlmProvider | undefined, clock = { t: 0 }) {
  const runs: AgentRunRecord[] = [];
  const client = createLlmClient({
    provider: primary,
    fallback,
    maxConcurrency: 4,
    timeoutMs: 50,
    maxRetries: 2,
    backoffMs: () => 0,
    now: () => clock.t,
    recordRun: (r) => {
      runs.push(r);
    },
  });
  return { llm: client.forContext(), runs };
}

const down = () => Promise.reject(new LlmError('server_error', 'Selectel лежит', 503));

describe('llm client: запасная модель', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('основная отвечает – запасная не вызывается', async () => {
    const main = provider('selectel', async () => result('selectel'));
    const spare = provider('yandex-qwen', async () => result('yandex-qwen'));
    const { llm } = setup(main, spare);
    expect((await llm.complete(req)).provider).toBe('selectel');
    expect(spare.calls).toBe(0);
  });

  it('5xx после всех ретраев – ответ запасной, оба исхода в журнале', async () => {
    const main = provider('selectel', down);
    const spare = provider('yandex-qwen', async () => result('yandex-qwen'));
    const { llm, runs } = setup(main, spare);
    const res = await llm.complete(req);
    expect(res.provider).toBe('yandex-qwen');
    expect(main.calls).toBe(3);
    expect(runs.map((r) => [r.provider, r.ok])).toEqual([
      ['selectel', false],
      ['yandex-qwen', true],
    ]);
  });

  it('таймаут и сетевой сбой (без ретраев) тоже уводят в запасную', async () => {
    const hang = provider('selectel', () => new Promise(() => {}));
    const spare = provider('yandex-qwen', async () => result('yandex-qwen'));
    expect((await setup(hang, spare).llm.complete(req)).provider).toBe('yandex-qwen');
    expect(hang.calls).toBe(1);

    const refused = provider('selectel', () => Promise.reject(new TypeError('fetch failed')));
    expect((await setup(refused, provider('yandex-qwen', async () => result('yandex-qwen'))).llm.complete(req)).provider).toBe(
      'yandex-qwen',
    );
  });

  it('после сбоя основная пропускается на время окна, потом пробуется снова', async () => {
    const clock = { t: 0 };
    let mainUp = false;
    const main = provider('selectel', () => (mainUp ? Promise.resolve(result('selectel')) : down()));
    const spare = provider('yandex-qwen', async () => result('yandex-qwen'));
    const { llm } = setup(main, spare, clock);
    await llm.complete(req);
    expect(main.calls).toBe(3);

    mainUp = true;
    clock.t = FALLBACK_COOLDOWN_MS - 1;
    expect((await llm.complete(req)).provider).toBe('yandex-qwen');
    expect(main.calls).toBe(3);

    clock.t = FALLBACK_COOLDOWN_MS;
    expect((await llm.complete(req)).provider).toBe('selectel');
  });

  it('показанный поток основной убирается перед ответом запасной', async () => {
    const main = provider('selectel', async (r) => {
      r.onDelta?.('полуответ');
      throw new LlmError('server_error', 'обрыв', 502);
    });
    const spare = provider('yandex-qwen', async (r) => {
      r.onDelta?.('ответ');
      return result('yandex-qwen');
    });
    const { llm } = setup(main, spare);
    const shown: string[] = [];
    await llm.complete({ ...req, onDelta: (t) => shown.push(t), onDiscard: () => shown.splice(0) });
    expect(shown).toEqual(['ответ']);
  });

  it('отмена вызывающим не уводит в запасную', async () => {
    const ctrl = new AbortController();
    const main = provider('selectel', (_r, signal) => new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason))));
    const spare = provider('yandex-qwen', async () => result('yandex-qwen'));
    const { llm } = setup(main, spare);
    const pending = llm.complete(req, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ code: 'aborted' });
    expect(spare.calls).toBe(0);
  });

  it('без запасной ошибка основной уходит вызывающему как раньше', async () => {
    const { llm } = setup(provider('selectel', down), undefined);
    await expect(llm.complete(req)).rejects.toMatchObject({ code: 'server_error', status: 503 });
  });
});
