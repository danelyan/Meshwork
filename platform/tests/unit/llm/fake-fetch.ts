import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Тело фикстуры HTTP-ответа (tests/unit/llm/fixtures/*.json). */
export function fixture(name: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8'));
}

export interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

type Reply = { status?: number; body: unknown } | ((signal?: AbortSignal) => Promise<{ status?: number; body: unknown }>);

/** fetch без сети: отдаёт ответы по очереди и запоминает запросы. */
export function fakeFetch(replies: Reply[]) {
  const calls: Captured[] = [];
  let i = 0;
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const bodyText = typeof init?.body === 'string' ? init.body : '{}';
    calls.push({ url, headers: new Headers(init?.headers), body: JSON.parse(bodyText) as Record<string, unknown> });
    const r = replies[Math.min(i++, replies.length - 1)];
    if (!r) throw new Error('fakeFetch: нет ответа');
    const out = typeof r === 'function' ? await r(init?.signal ?? undefined) : r;
    return new Response(JSON.stringify(out.body), {
      status: out.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetch: fn, calls };
}
