import { createLlmClient, isRetryable, redactPii, retryAfterMs, RETRY_AFTER_CAP_MS } from '@/server/llm/client';
import { isContextLengthMessage } from '@/server/llm/errors';
import { createOpenAiChatProvider } from '@/server/llm/providers/openai-chat';
import { createYandexResponsesProvider, toResponsesBody } from '@/server/llm/providers/yandex-responses';
import { LlmError, type CompleteRequest, type LlmProvider } from '@/server/llm/types';
import { fakeFetch } from './fake-fetch';

const base: CompleteRequest = { purpose: 'consultant', system: 'Ты консультант.', messages: [{ role: 'user', content: 'привет' }] };
const tool = { name: 'get_profile', description: 'Профиль', parameters: { type: 'object', properties: {} } };
const schema = { name: 'answer', jsonSchema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } };

describe('Yandex: structured output не совмещается с tools (дока AI Studio «Структурированный вывод»)', () => {
  it('только schema → text.format json_schema', () => {
    const body = toResponsesBody({ ...base, schema }, 'gpt://f/m', {});
    expect(body.text).toMatchObject({ format: { type: 'json_schema', name: 'answer' } });
  });
  it('tools + schema → tools остаются, схема уходит текстом в instructions, text.format нет', () => {
    const body = toResponsesBody({ ...base, schema, tools: [tool] }, 'gpt://f/m', {});
    expect(body.tools).toHaveLength(1);
    expect(body.text).toBeUndefined();
    expect(String(body.instructions)).toContain('«answer»');
  });
});

describe('превышение контекста → LlmError context_length, без ретрая', () => {
  it.each([
    'This model\'s maximum context length is 32768 tokens. However, your messages resulted in 40000 tokens.',
    'Input tokens count exceeds the limit',
    'Request too large: too many input tokens',
    'Превышен лимит длины контекста',
  ])('распознаёт: %s', (msg) => expect(isContextLengthMessage(msg)).toBe(true));

  it('обычная 400 – не контекст', () => expect(isContextLengthMessage('Invalid value for tool_choice')).toBe(false));

  it('Yandex 400 с текстом о лимите токенов → context_length', async () => {
    const ff = fakeFetch([{ status: 400, body: { error: { message: 'Input tokens count exceeds the limit of 32768', type: 'invalid_request_error' } } }]);
    const p = createYandexResponsesProvider({ apiKey: 'k', folderId: 'f', model: 'm', baseUrl: 'https://ai.api.cloud.yandex.net/v1', fetch: ff.fetch });
    await expect(p.complete(base)).rejects.toMatchObject({ code: 'context_length', status: 400 });
  });

  it('OpenAI-совместимый: code context_length_exceeded → context_length', async () => {
    const ff = fakeFetch([{ status: 400, body: { error: { message: 'too long', code: 'context_length_exceeded', type: 'invalid_request_error' } } }]);
    const p = createOpenAiChatProvider({ apiKey: 'k', model: 'm', baseUrl: 'https://example.test/v1', fetch: ff.fetch });
    await expect(p.complete(base)).rejects.toMatchObject({ code: 'context_length' });
  });

  it('client не ретраит context_length', async () => {
    expect(isRetryable(new LlmError('context_length', 'x', 400))).toBe(false);
    let n = 0;
    const provider: LlmProvider = {
      name: 'p', model: 'm', supportsTools: true, supportsJsonSchema: true,
      complete: async () => {
        n++;
        throw new LlmError('context_length', 'не влезло', 400);
      },
    };
    const c = createLlmClient({ provider, maxConcurrency: 1, timeoutMs: 1000, maxRetries: 3, backoffMs: () => 0 });
    await expect(c.forContext().complete(base)).rejects.toMatchObject({ code: 'context_length' });
    expect(n).toBe(1);
  });
});

describe('Retry-After и журнал без ПДн', () => {
  it('Retry-After в секундах – из заголовков ошибки или её cause; с потолком', () => {
    const apiErr = { status: 429, headers: new Headers({ 'retry-after': '2' }) };
    expect(retryAfterMs(apiErr)).toBe(2000);
    expect(retryAfterMs(new LlmError('rate_limited', 'x', 429, { cause: apiErr }))).toBe(2000);
    expect(retryAfterMs({ headers: new Headers({ 'retry-after': '120' }) })).toBe(RETRY_AFTER_CAP_MS);
    expect(retryAfterMs(new LlmError('rate_limited', 'x', 429))).toBeUndefined();
  });

  it('Retry-After как HTTP-дата', () => {
    const now = Date.parse('2026-10-09T10:00:00Z');
    expect(retryAfterMs({ headers: new Headers({ 'retry-after': 'Fri, 09 Oct 2026 10:00:03 GMT' }) }, now)).toBe(3000);
  });

  it('почта, телефон и ключ маскируются', () => {
    const t = redactPii('bad input: ivan.petrov@example.com, +7 900 000-00-01, key AQVN1234567890abcdef');
    expect(t).not.toMatch(/example\.com|900 000|AQVN1234/);
    expect(t).toContain('[email]');
    expect(t).toContain('[phone]');
    expect(t).toContain('[key]');
  });

  it('ошибка в журнале AgentRun проходит через маскировку', async () => {
    const runs: { error: string | null }[] = [];
    const provider: LlmProvider = {
      name: 'p', model: 'm', supportsTools: true, supportsJsonSchema: true,
      complete: async () => {
        throw new LlmError('bad_request', 'schema error near "ivan@example.com"', 400);
      },
    };
    const c = createLlmClient({ provider, maxConcurrency: 1, timeoutMs: 1000, maxRetries: 0, recordRun: (r) => void runs.push(r) });
    await expect(c.forContext().complete(base)).rejects.toBeInstanceOf(LlmError);
    expect(runs[0]?.error).toContain('[email]');
    expect(runs[0]?.error).not.toContain('ivan@example.com');
  });
});
