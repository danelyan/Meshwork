import { createLlmClient } from '@/server/llm/client';
import { collectStream, createOpenAiChatProvider } from '@/server/llm/providers/openai-chat';
import type { CompleteRequest, CompleteResult, LlmProvider } from '@/server/llm/types';

const sse = (chunks: unknown[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
const chunk = (delta: object, finish: string | null = null) => ({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [{ index: 0, delta, finish_reason: finish }] });

function provider(body: string, seen: Record<string, unknown>[] = []) {
  return createOpenAiChatProvider({
    baseUrl: 'https://llm.example/v1',
    apiKey: 'k',
    model: 'm',
    fetch: async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)));
      return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    },
  });
}

const req: CompleteRequest = { purpose: 'consultant', system: 's', messages: [{ role: 'user', content: 'hi' }] };

describe('openai-chat: стриминг (stream: true)', () => {
  it('content уходит в onDelta по кускам, итог и usage собираются как у обычного ответа', async () => {
    const seen: Record<string, unknown>[] = [];
    const body = sse([chunk({ role: 'assistant', content: '' }), chunk({ content: 'При' }), chunk({ content: 'вет' }), chunk({}, 'stop'), { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm', choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }]);
    const deltas: string[] = [];
    const res = await provider(body, seen).complete({ ...req, onDelta: (t) => deltas.push(t) });
    expect(deltas).toEqual(['При', 'вет']);
    expect(res).toMatchObject({ kind: 'text', text: 'Привет', usage: { inputTokens: 5, outputTokens: 2 } });
    expect(seen[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
  });

  it('tool_calls склеиваются по index; текст после начала вызовов в onDelta не идёт', async () => {
    const body = sse([
      chunk({ tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'search', arguments: '{"q":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '"go"}' } }] }),
      chunk({ content: 'лишнее' }),
      chunk({}, 'tool_calls'),
    ]);
    const deltas: string[] = [];
    const res = await provider(body).complete({ ...req, tools: [{ name: 'search', description: 'd', parameters: { type: 'object' } }], onDelta: (t) => deltas.push(t) });
    expect(res.kind).toBe('tool_calls');
    expect(res.toolCalls).toEqual([{ id: 'call_1', name: 'search', arguments: { q: 'go' } }]);
    expect(deltas).toEqual([]);
  });

  it('без onDelta — обычный запрос без stream', async () => {
    const seen: Record<string, unknown>[] = [];
    const p = createOpenAiChatProvider({
      baseUrl: 'https://llm.example/v1',
      apiKey: 'k',
      model: 'm',
      fetch: async (_u: string | URL | Request, init?: RequestInit) => {
        seen.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      },
    });
    await p.complete(req);
    expect(seen[0]!.stream).toBeUndefined();
  });

  it('collectStream: обрыв без usage — нули, не падение', async () => {
    async function* gen() {
      yield chunk({ content: 'a' });
    }
    const out = await collectStream(gen(), () => {});
    expect(out.usage).toBeNull();
    expect(out.choices?.[0]?.message?.content).toBe('a');
  });
});

describe('llm client: onDelta', () => {
  const ok = (text: string): CompleteResult => ({ kind: 'text', text, usage: { inputTokens: 1, outputTokens: 1 }, latencyMs: 1, provider: 'f', model: 'f' });
  const fake = (impl: LlmProvider['complete'], supportsTools = true): LlmProvider => ({ name: 'f', model: 'f', supportsTools, supportsJsonSchema: true, complete: impl });

  it('доходит до провайдера для свободного текста', async () => {
    const got: string[] = [];
    const client = createLlmClient({ provider: fake(async (r) => (r.onDelta?.('x'), ok('x'))), maxConcurrency: 1, timeoutMs: 1000, maxRetries: 0 });
    await client.forContext().complete({ ...req, onDelta: (t) => got.push(t) });
    expect(got).toEqual(['x']);
  });

  it('снимается для JSON-схемы и плана В (там служебный JSON)', async () => {
    const seen: (unknown | undefined)[] = [];
    const impl: LlmProvider['complete'] = async (r) => (seen.push(r.onDelta), ok('{"action":"reply","text":"t"}'));
    const client = createLlmClient({ provider: fake(impl, false), maxConcurrency: 1, timeoutMs: 1000, maxRetries: 0 });
    await client.forContext().complete({ ...req, schema: { name: 's', jsonSchema: { type: 'object' } }, onDelta: () => {} });
    await client
      .forContext()
      .complete({ ...req, tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }], onDelta: () => {} })
      .catch(() => undefined);
    expect(seen.every((d) => d === undefined)).toBe(true);
  });

  it('повтор после попытки, успевшей показать текст, идёт без дельт', async () => {
    let n = 0;
    const got: string[] = [];
    const impl: LlmProvider['complete'] = async (r) => {
      n++;
      if (n === 1) {
        r.onDelta?.('пол');
        throw Object.assign(new Error('503'), { status: 503 });
      }
      expect(r.onDelta).toBeUndefined();
      return ok('полный');
    };
    const client = createLlmClient({ provider: fake(impl), maxConcurrency: 1, timeoutMs: 1000, maxRetries: 1, backoffMs: () => 0 });
    const res = await client.forContext().complete({ ...req, onDelta: (t) => got.push(t) });
    expect(res.text).toBe('полный');
    expect(got).toEqual(['пол']);
  });
});
