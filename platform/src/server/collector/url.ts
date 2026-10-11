import type { LookupAddress, LookupOptions } from 'node:dns';

import { Agent, request } from 'undici';

import { AppError } from '../errors';
import { buildDoc } from './doc';
import { extractFile } from './files';
import { extractHtml } from './html';
import { LIMITS } from './limits';
import { blockedUrl, checkUrl, systemResolver, type CheckedTarget, type Resolver } from './ssrf';
import type { ExtractedDoc } from './types';

/**
 * Чтение произвольного URL через SSRF-фильтры (ssrf.ts):
 * проверка → DNS → соединение строго на проверенный IP (undici `connect.lookup`) →
 * ручные редиректы (≤ 3), каждый хост проверяется заново → таймаут 8 с на всё →
 * тело потоково, не больше 2 МБ → только html / plain / pdf.
 */

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>;
  /** Освободить соединение, не дочитывая тело. */
  discard(): Promise<void>;
}
export type HttpGet = (target: CheckedTarget, signal: AbortSignal) => Promise<HttpResponse>;

export const fetchFailed = (message: string, status = 502) => new AppError('fetch_failed', message, status);

const USER_AGENT = 'MESHWORK-Collector/1.0 (+candidate-provided link reader)';

/** lookup, который всегда возвращает заранее проверенный адрес — DNS-rebinding между проверкой и connect невозможен. */
export function pinnedLookup(target: Pick<CheckedTarget, 'address' | 'family'>) {
  return (
    _hostname: string,
    options: LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
  ) => {
    if (options && options.all) callback(null, [{ address: target.address, family: target.family }]);
    else callback(null, target.address, target.family);
  };
}

/** Реальный HTTP-слой на undici: свой Agent на каждый hop, пиннинг адреса, без авто-редиректов. */
export const undiciGet: HttpGet = async (target, signal) => {
  const agent = new Agent({
    connect: { lookup: pinnedLookup(target), timeout: LIMITS.urlTimeoutMs },
    headersTimeout: LIMITS.urlTimeoutMs,
    bodyTimeout: LIMITS.urlTimeoutMs,
    maxResponseSize: LIMITS.urlMaxBytes * 2,
  });
  const res = await request(target.url, {
    method: 'GET',
    dispatcher: agent,
    signal,
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/pdf;q=0.8',
      'accept-encoding': 'identity',
    },
  }).catch(async (err: unknown) => {
    await agent.close().catch(() => undefined);
    throw err;
  });
  const body = res.body;
  return {
    status: res.statusCode,
    headers: res.headers,
    body: (async function* () {
      try {
        for await (const chunk of body) yield chunk as Uint8Array;
      } finally {
        await agent.close().catch(() => undefined);
      }
    })(),
    discard: async () => {
      body.destroy();
      await agent.destroy().catch(() => undefined);
    },
  };
};

const header = (h: HttpResponse['headers'], name: string): string | undefined => {
  const v = h[name] ?? h[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
};

type ContentKind = 'html' | 'plain' | 'pdf';
export function contentKind(contentType: string | undefined): ContentKind | null {
  const t = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (t === 'text/html' || t === 'application/xhtml+xml') return 'html';
  if (t === 'text/plain' || t === 'text/markdown') return 'plain';
  if (t === 'application/pdf') return 'pdf';
  return null;
}

function decode(buf: Buffer, contentType: string | undefined, sniffMeta: boolean): string {
  let charset = /charset\s*=\s*"?([\w-]+)/i.exec(contentType ?? '')?.[1];
  if (!charset && sniffMeta) {
    charset = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(buf.subarray(0, 2048).toString('latin1'))?.[1];
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function readLimited(res: HttpResponse, limit: number): Promise<{ buf: Buffer; truncated: boolean }> {
  const declared = Number(header(res.headers, 'content-length'));
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = Number.isFinite(declared) && declared > limit;
  if (!truncated) {
    for await (const chunk of res.body) {
      const b = Buffer.from(chunk);
      if (size + b.length > limit) {
        chunks.push(b.subarray(0, limit - size));
        size = limit;
        truncated = true;
        break;
      }
      chunks.push(b);
      size += b.length;
    }
  }
  if (truncated) await res.discard();
  return { buf: Buffer.concat(chunks), truncated };
}

export interface UrlFetcherDeps {
  resolve?: Resolver;
  httpGet?: HttpGet;
  timeoutMs?: number;
  maxRedirects?: number;
  maxBytes?: number;
}

export function createUrlFetcher(deps: UrlFetcherDeps = {}) {
  const resolve = deps.resolve ?? systemResolver;
  const httpGet = deps.httpGet ?? undiciGet;
  const timeoutMs = deps.timeoutMs ?? LIMITS.urlTimeoutMs;
  const maxRedirects = deps.maxRedirects ?? LIMITS.urlMaxRedirects;
  const maxBytes = deps.maxBytes ?? LIMITS.urlMaxBytes;

  return async function fetchUrl(rawUrl: string): Promise<ExtractedDoc> {
    const signal = AbortSignal.timeout(timeoutMs);
    let current = rawUrl;
    let res: HttpResponse | undefined;
    let target: CheckedTarget | undefined;
    try {
      for (let hop = 0; ; hop++) {
        target = await checkUrl(current, resolve);
        res = await httpGet(target, signal);
        if (res.status >= 300 && res.status < 400) {
          const location = header(res.headers, 'location');
          await res.discard();
          if (!location) throw fetchFailed('Сайт вернул редирект без адреса');
          if (hop + 1 > maxRedirects) throw blockedUrl(`больше ${maxRedirects} редиректов`);
          let next: URL;
          try {
            next = new URL(location, target.url);
          } catch {
            throw blockedUrl('некорректный адрес редиректа');
          }
          current = next.href;
          continue;
        }
        break;
      }
      if (!res || !target) throw fetchFailed('Пустой ответ');
      if (res.status < 200 || res.status >= 300) {
        await res.discard();
        throw fetchFailed(`Сайт ответил ${res.status}`);
      }
      const ct = header(res.headers, 'content-type');
      const kind = contentKind(ct);
      if (!kind) {
        await res.discard();
        // Картинки по ссылке в OCR не отправляем (платный вызов на чужой контент) — просим загрузить файлом.
        if (/^image\//i.test(ct ?? '')) {
          throw new AppError('unsupported_media_type', 'По ссылке картинка — сохрани её и прикрепи файлом JPG или PNG, текст распознаем', 415);
        }
        throw new AppError('unsupported_media_type', 'По ссылке не страница, не текст и не PDF', 415);
      }
      const { buf, truncated } = await readLimited(res, maxBytes);
      const finalUrl = target.url.href;

      if (kind === 'pdf') {
        if (truncated) throw new AppError('payload_too_large', 'PDF по ссылке больше 2 МБ', 413);
        const name = target.url.pathname.split('/').pop() || `${target.url.hostname}.pdf`;
        return await extractFile(buf, name, 'application/pdf', { sourceKind: 'url', origin: finalUrl });
      }
      const text = decode(buf, ct, kind === 'html');
      const doc =
        kind === 'html'
          ? extractHtml(text, finalUrl)
          : buildDoc({
              sourceKind: 'url',
              title: finalUrl,
              origin: finalUrl,
              lines: text.split(/\r?\n/).map((t, i) => ({ ref: `${finalUrl}#l${i + 1}`, text: t })),
            });
      if (truncated) doc.flags.truncated = true;
      if (finalUrl !== rawUrl) doc.meta = { ...doc.meta, requestedUrl: rawUrl };
      return doc;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (signal.aborted) throw fetchFailed('Сайт не ответил за 8 секунд', 504);
      throw fetchFailed('Не удалось загрузить страницу');
    }
  };
}

let defaultFetcher: ReturnType<typeof createUrlFetcher> | undefined;

/** Любой URL через SSRF-фильтры (ssrf.ts). Заблокированный адрес → AppError `blocked_url`, сеть → `fetch_failed`. */
export async function fetchUrl(url: string): Promise<ExtractedDoc> {
  defaultFetcher ??= createUrlFetcher();
  return defaultFetcher(url);
}
