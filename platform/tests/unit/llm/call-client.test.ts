import type { LlmProvider, CompleteRequest, CompleteResult } from '@/server/llm/types';
import { LlmError } from '@/server/llm/types';

const state = vi.hoisted(() => ({ env: {} as Record<string, unknown>, call: undefined as unknown, main: undefined as unknown, runs: [] as unknown[] }));

vi.mock('@/server/env', () => ({ getEnv: () => state.env }));
vi.mock('@/server/db', () => ({ prisma: { agentRun: { create: async ({ data }: { data: unknown }) => void state.runs.push(data) } } }));
vi.mock('@/server/llm/providers', () => ({
  createProvider: () => state.main,
  createFallbackProvider: () => undefined,
  createCallProvider: () => state.call,
}));

import { getLlm, resetLlmClient, getCallLlmClient, getLlmClient } from '@/server/llm/client';

const req: CompleteRequest = { purpose: 'smoke', system: 's', messages: [{ role: 'user', content: 'hi' }] };

function provider(name: string, fail = false): LlmProvider & { calls: number } {
  const p = {
    name,
    model: `${name}-1`,
    supportsTools: true,
    supportsJsonSchema: true,
    calls: 0,
    complete: async (): Promise<CompleteResult> => {
      p.calls++;
      if (fail) throw new LlmError('server_error', 'лежит', 503);
      return { kind: 'text', text: name, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, provider: name, model: `${name}-1` };
    },
  };
  return p;
}

describe('getLlm({ purpose: "call" })', () => {
  beforeEach(() => {
    resetLlmClient();
    state.runs = [];
    state.env = { LLM_MAX_CONCURRENCY: 4, LLM_TIMEOUT_MS: 1000, LLM_MAX_RETRIES: 0 };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('LLM_CALL_* задан: созвон идёт на call-модели, чат — на основной; имя call-провайдера в журнале', async () => {
    const main = provider('main');
    const call = provider('call-qwen');
    state.main = main;
    state.call = call;
    expect((await getLlm({ purpose: 'call' }).complete(req)).provider).toBe('call-qwen');
    expect((await getLlm().complete(req)).provider).toBe('main');
    expect(call.calls).toBe(1);
    expect(main.calls).toBe(1);
    expect(state.runs).toMatchObject([{ provider: 'call-qwen', ok: true }, { provider: 'main', ok: true }]);
  });

  it('call-модель отвечает 5xx — запрос уходит на основную', async () => {
    const main = provider('main');
    const call = provider('call-qwen', true);
    state.main = main;
    state.call = call;
    expect((await getLlm({ purpose: 'call' }).complete(req)).provider).toBe('main');
    expect(call.calls).toBe(1);
    expect(main.calls).toBe(1);
  });

  it('LLM_CALL_* не задан: тот же клиент, что и без purpose', async () => {
    const main = provider('main');
    state.main = main;
    state.call = undefined;
    expect(getCallLlmClient()).toBe(getLlmClient());
    expect((await getLlm({ purpose: 'call' }).complete(req)).provider).toBe('main');
  });
});
