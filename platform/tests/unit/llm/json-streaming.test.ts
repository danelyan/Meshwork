// Потоковый JSON по схеме (onJsonDelta) — для вопроса интервьюера созвона (лейн call-speed, 11.10).
import { createLlmClient } from '@/server/llm/client';
import { createOpenAiChatProvider } from '@/server/llm/providers/openai-chat';
import { LlmError, type CompleteRequest, type CompleteResult, type LlmProvider } from '@/server/llm/types';

const sse = (chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
const chunk = (delta: object, finish: string | null = null) => ({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });
const schema = { name: 'call_question', jsonSchema: { type: 'object', properties: { question: { type: 'string' } } } };
const req: CompleteRequest = { purpose: 'call_interviewer', system: 's', messages: [{ role: 'user', content: 'hi' }], schema };

function provider(body: string, seen: Record<string, unknown>[] = [], stream?: boolean) {
  return createOpenAiChatProvider({
    baseUrl: 'https://llm.example/v1',
    apiKey: 'k',
    model: 'm',
    ...(stream === undefined ? {} : { stream }),
    fetch: async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      const isStream = JSON.parse(String(init?.body)).stream === true;
      return isStream
        ? new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
        : new Response(JSON.stringify({ choices: [{ message: { content: '{"question":"Целиком?"}' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
}

describe('openai-chat: JSON по схеме потоком (onJsonDelta)', () => {
  it('с onJsonDelta — stream + response_format, куски сырого JSON по порядку, итог разобран как json', async () => {
    const seen: Record<string, unknown>[] = [];
    const body = sse([chunk({ content: '{"quest' }), chunk({ content: 'ion":"Привет. ' }), chunk({ content: 'Как дела?"}' }), chunk({}, 'stop')]);
    const got: string[] = [];
    const res = await provider(body, seen).complete({ ...req, onJsonDelta: (c) => got.push(c) });
    expect(got.join('')).toBe('{"question":"Привет. Как дела?"}');
    expect(res).toMatchObject({ kind: 'json', json: { question: 'Привет. Как дела?' } });
    expect(seen[0]).toMatchObject({ stream: true, response_format: { type: 'json_schema' } });
  });

  it('без onJsonDelta или со stream: false — обычный запрос целиком (фолбэк)', async () => {
    const seen: Record<string, unknown>[] = [];
    await provider('', seen).complete(req);
    const got: string[] = [];
    const res = await provider('', seen, false).complete({ ...req, onJsonDelta: (c) => got.push(c) });
    expect(seen.map((b) => b.stream)).toEqual([undefined, undefined]);
    expect(got).toEqual([]);
    expect(res.json).toEqual({ question: 'Целиком?' });
  });

  it('onDelta при схеме по-прежнему не стримит (консультант не задет)', async () => {
    const seen: Record<string, unknown>[] = [];
    await provider('', seen).complete({ ...req, onDelta: () => {} });
    expect(seen[0]!.stream).toBeUndefined();
  });
});

describe('llm client: onJsonDelta', () => {
  const ok = (json: unknown): CompleteResult => ({ kind: 'json', json, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, provider: 'f', model: 'f' });
  const fake = (impl: LlmProvider['complete'], supportsTools = true): LlmProvider => ({ name: 'f', model: 'f', supportsTools, supportsJsonSchema: true, complete: impl });

  it('доходит до провайдера при схеме; без схемы снимается', async () => {
    const seen: unknown[] = [];
    const client = createLlmClient({ provider: fake(async (r) => (seen.push(r.onJsonDelta), ok({}))), maxConcurrency: 1, timeoutMs: 1000, maxRetries: 0 });
    await client.forContext().complete({ ...req, onJsonDelta: () => {} });
    await client.forContext().complete({ ...req, schema: undefined, onJsonDelta: () => {} });
    expect(typeof seen[0]).toBe('function');
    expect(seen[1]).toBeUndefined();
  });

  it('обрыв после начала потока (503) — без повтора: кандидат уже слышит начало', async () => {
    let n = 0;
    const impl: LlmProvider['complete'] = async (r) => {
      n++;
      r.onJsonDelta?.('{"question":"Нача');
      throw Object.assign(new Error('503'), { status: 503 });
    };
    const client = createLlmClient({ provider: fake(impl), maxConcurrency: 1, timeoutMs: 1000, maxRetries: 2, backoffMs: () => 0 });
    await expect(client.forContext().complete({ ...req, onJsonDelta: () => {} })).rejects.toBeInstanceOf(LlmError);
    expect(n).toBe(1);
  });

  it('503 до первого куска — обычный повтор', async () => {
    let n = 0;
    const impl: LlmProvider['complete'] = async () => {
      n++;
      if (n === 1) throw Object.assign(new Error('503'), { status: 503 });
      return ok({ question: 'ok' });
    };
    const client = createLlmClient({ provider: fake(impl), maxConcurrency: 1, timeoutMs: 1000, maxRetries: 1, backoffMs: () => 0 });
    await client.forContext().complete({ ...req, onJsonDelta: () => {} });
    expect(n).toBe(2);
  });

  it('таймаут посреди потока — LlmError timeout, поток не висит', async () => {
    const impl: LlmProvider['complete'] = (r, signal) =>
      new Promise((_, reject) => {
        r.onJsonDelta?.('{"question":"Начало. ');
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    const client = createLlmClient({ provider: fake(impl), maxConcurrency: 1, timeoutMs: 1000, maxRetries: 1, backoffMs: () => 0 });
    const got: string[] = [];
    const err = await client.forContext().complete({ ...req, timeoutMs: 30, onJsonDelta: (c) => got.push(c) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect((err as LlmError).code).toBe('timeout');
    expect(got).toEqual(['{"question":"Начало. ']);
  });
});
