import { deflateSync } from 'node:zlib';

import { getEnv } from '@/server/env';
import { AppError } from '../errors';
import type { RawLine } from './doc';
import { LIMITS } from './limits';

/**
 * Yandex Vision OCR, синхронный REST `recognizeText` (дока: aistudio.yandex.ru/docs/ru/vision/ocr/api-ref/TextRecognition/recognize).
 * Форматы — JPEG, PNG, PDF; файл ≤ 10 МБ, картинка ≤ 20 Мпикс; PDF в синхронном режиме — только одна страница.
 * Распознанный текст — недоверенные данные: дальше он идёт через buildDoc (маскирование, детектор инъекций).
 */
export const OCR_TIMEOUT_MS = 20_000;

export type OcrMime = 'image/jpeg' | 'image/png' | 'application/pdf';

interface OcrConfig {
  url: string;
  apiKey: string;
  folderId: string;
}

/** Настройки OCR или null, если выключен (OCR_PROVIDER=off, нет OCR_API_KEY или каталога). */
export function ocrConfig(): OcrConfig | null {
  const env = getEnv();
  // Только отдельный ключ со scope yc.ai.vision.execute: основной YANDEX_API_KEY на Vision отвечает 403.
  const apiKey = env.OCR_API_KEY;
  const folderId = env.OCR_FOLDER_ID ?? env.YANDEX_FOLDER_ID;
  if (env.OCR_PROVIDER === 'off' || !apiKey || !folderId) return null;
  return { url: env.OCR_URL, apiKey, folderId };
}

export function ocrEnabled(): boolean {
  return ocrConfig() !== null;
}

/** Ответ recognizeText (только используемые поля). */
interface VisionLine {
  text?: string;
}
interface VisionResponse {
  page?: string | number;
  textAnnotation?: { blocks?: { lines?: VisionLine[] }[]; fullText?: string };
  result?: VisionResponse;
}

export const ocrUnavailable = (message = 'Распознавание текста сейчас недоступно') => new AppError('ocr_unavailable', message, 503);

/**
 * Строки распознанного текста в порядке блоков и строк ответа → `file#p<page>:l<n>`.
 * Ответ может прийти одним объектом или потоком JSON-объектов по строке (по одному на страницу) — разбираем оба.
 */
export function visionToLines(body: string, name: string, defaultPage = 1): RawLine[] {
  const objs: VisionResponse[] = [];
  const trimmed = body.trim();
  try {
    objs.push(JSON.parse(trimmed) as VisionResponse);
  } catch {
    for (const chunk of trimmed.split(/\n+/)) {
      if (!chunk.trim()) continue;
      try {
        objs.push(JSON.parse(chunk) as VisionResponse);
      } catch {
        /* битый фрагмент пропускаем */
      }
    }
  }
  const counters = new Map<number, number>();
  const out: RawLine[] = [];
  for (const raw of objs) {
    const r = raw.result ?? raw;
    const pageNum = Number(r.page);
    const page = Number.isFinite(pageNum) && pageNum > 0 ? pageNum : defaultPage;
    const blocks = r.textAnnotation?.blocks;
    const texts = blocks
      ? blocks.flatMap((b) => (b.lines ?? []).map((l) => l.text ?? ''))
      : (r.textAnnotation?.fullText ?? '').split(/\r?\n/);
    for (const t of texts) {
      const text = t.trim();
      if (!text) continue;
      const n = (counters.get(page) ?? 0) + 1;
      counters.set(page, n);
      out.push({ ref: `${name}#p${page}:l${n}`, text });
    }
  }
  return out;
}

/**
 * Распознать текст картинки или одностраничного PDF. Ошибки — AppError с русским текстом; ключ в сообщения
 * и логи не попадает. 401/403 (нет роли ai.vision.user, неверный ключ) и выключенный OCR — `ocr_unavailable`.
 */
export async function recognizeText(
  buf: Buffer,
  mimeType: OcrMime,
  name: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; page?: number } = {},
): Promise<RawLine[]> {
  const cfg = ocrConfig();
  if (!cfg) throw ocrUnavailable('Распознавание текста выключено');
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? OCR_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        Authorization: `Api-Key ${cfg.apiKey}`,
        'x-folder-id': cfg.folderId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mimeType, languageCodes: ['ru', 'en'], model: 'page', content: buf.toString('base64') }),
      signal,
    });
  } catch (e) {
    const timedOut = timeout.aborted || (e instanceof Error && e.name === 'TimeoutError');
    console.warn('ocr: запрос не выполнен', timedOut ? 'timeout' : e instanceof Error ? e.name : 'error');
    throw ocrUnavailable(timedOut ? 'Распознавание текста не уложилось во время' : 'Сервис распознавания текста недоступен');
  }
  if (!res.ok) {
    console.warn('ocr: ответ Vision', res.status);
    if (res.status === 401 || res.status === 403) throw ocrUnavailable();
    if (res.status === 400 || res.status === 413) {
      throw new AppError('ocr_failed', 'Не удалось распознать файл: слишком большое изображение или неподдерживаемый формат', 422);
    }
    throw ocrUnavailable('Сервис распознавания текста недоступен');
  }
  const body = await res.text();
  return visionToLines(body, name, opts.page ?? 1);
}

/* REST async Vision (recognizePdfAsync) на нашем аккаунте 11.10.2026 отвечает 404 — не вызывается, см. recognizePdfScan. */
export const OCR_ASYNC_TIMEOUT_MS = 45_000;
export const OCR_ASYNC_POLL_MS = 1_000;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done);
  });

/**
 * Многостраничный PDF через асинхронный Vision: `POST …/recognizeTextAsync` → операция `{id}` →
 * `GET …/getRecognition?operationId=<id>`; готовность — HTTP 200 с непустым телом (JSON Lines, по объекту на страницу).
 * Лимиты доки: файл ≤ 10 МБ, ≤ 200 страниц; мы берём не больше LIMITS.pdfMaxPages. Опрос раз в ~1 с, общий таймаут 45 с.
 * Номера страниц ответа нормализуются к 1-based (если Vision отдал 0-based). Ошибки — те же коды, что у recognizeText.
 */
export async function recognizePdfAsync(
  buf: Buffer,
  name: string,
  opts: { signal?: AbortSignal; timeoutMs?: number; pollMs?: number; maxPages?: number } = {},
): Promise<RawLine[]> {
  const cfg = ocrConfig();
  if (!cfg) throw ocrUnavailable('Распознавание текста выключено');
  const maxPages = opts.maxPages ?? LIMITS.pdfMaxPages;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? OCR_ASYNC_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const headers = { Authorization: `Api-Key ${cfg.apiKey}`, 'x-folder-id': cfg.folderId };
  const base = cfg.url.replace(/\/recognizeText\/?$/, '');
  const tooSlow = () => ocrUnavailable('Распознавание текста не уложилось во время');

  const call = async (url: string, init: RequestInit): Promise<Response> => {
    try {
      return await fetch(url, { ...init, signal });
    } catch (e) {
      const timedOut = timeout.aborted || (e instanceof Error && e.name === 'TimeoutError');
      console.warn('ocr: async-запрос не выполнен', timedOut ? 'timeout' : e instanceof Error ? e.name : 'error');
      throw timedOut ? tooSlow() : ocrUnavailable('Сервис распознавания текста недоступен');
    }
  };
  const fail = (status: number): never => {
    console.warn('ocr: async-ответ Vision', status);
    if (status === 401 || status === 403) throw ocrUnavailable();
    if (status === 400 || status === 413) {
      throw new AppError('ocr_failed', 'Не удалось распознать файл: слишком большой PDF или неподдерживаемый формат', 422);
    }
    throw ocrUnavailable('Сервис распознавания текста недоступен');
  };

  const start = await call(`${base}/recognizeTextAsync`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType: 'application/pdf', languageCodes: ['ru', 'en'], model: 'page', content: buf.toString('base64') }),
  });
  if (!start.ok) return fail(start.status);
  let opId: string | undefined;
  try {
    opId = ((await start.json()) as { id?: string }).id;
  } catch {
    /* ниже */
  }
  if (!opId) throw ocrUnavailable('Сервис распознавания текста вернул неожиданный ответ');

  const pollMs = opts.pollMs ?? OCR_ASYNC_POLL_MS;
  while (!signal.aborted) {
    const res = await call(`${base}/getRecognition?operationId=${encodeURIComponent(opId)}`, { method: 'GET', headers });
    if (res.ok) {
      const body = await res.text();
      if (body.trim()) return pagedLines(body, name, maxPages);
    } else if (![404, 409, 425, 429, 500, 502, 503, 504].includes(res.status)) {
      return fail(res.status);
    }
    await sleep(pollMs, signal);
  }
  if (opts.signal?.aborted) throw ocrUnavailable('Распознавание текста отменено');
  throw tooSlow();
}

/** JSON Lines ответа → строки; страницы 0-based (если есть page 0) сдвигаются к 1-based, лишние сверх лимита отбрасываются. */
function pagedLines(body: string, name: string, maxPages: number): RawLine[] {
  const objs: VisionResponse[] = [];
  for (const chunk of body.trim().split(/\n+/)) {
    try {
      if (chunk.trim()) objs.push(JSON.parse(chunk) as VisionResponse);
    } catch {
      /* битый фрагмент пропускаем */
    }
  }
  if (objs.length === 0) {
    try {
      objs.push(JSON.parse(body) as VisionResponse);
    } catch {
      /* пусто */
    }
  }
  const pageOf = (o: VisionResponse) => Number((o.result ?? o).page);
  const zeroBased = objs.some((o) => pageOf(o) === 0);
  const shifted = objs.map((o, i) => {
    const n = pageOf(o);
    const page = Number.isFinite(n) ? n + (zeroBased ? 1 : 0) : i + 1;
    return { ...(o.result ?? o), page };
  });
  return visionToLines(
    shifted
      .filter((o) => o.page <= maxPages)
      .map((o) => JSON.stringify(o))
      .join('\n'),
    name,
  );
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** Минимальный PNG-энкодер (8 бит, фильтр 0): сырые пиксели Gray/RGB/RGBA → PNG. */
export function encodePng(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: 1 | 3 | 4): Buffer {
  const stride = width * channels;
  if (data.length < stride * height) throw new Error('png: мало данных');
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    raw.set(data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export const OCR_SCAN_TIMEOUT_MS = 60_000;
export const OCR_SCAN_CONCURRENCY = 3;

export interface PdfScanResult {
  lines: RawLine[];
  pagesOk: number;
  pagesFailed: number;
}

/**
 * Запасной путь для многостраничного скана без текстового слоя: из каждой страницы (≤ maxPages) берём самую
 * большую встроенную картинку (unpdf extractImages → сырые пиксели), кодируем в PNG и шлём в синхронный
 * recognizeText; ≤ 3 страниц параллельно, общий таймаут 60 с. Страница без картинки, больше 20 Мпикс или
 * с ошибкой OCR считается упавшей. Если упали все — бросает последнюю ошибку; иначе отдаёт распознанное.
 */
export async function recognizePdfScan(
  buf: Buffer,
  name: string,
  numPages: number,
  opts: { signal?: AbortSignal; timeoutMs?: number; maxPages?: number; maxPixels?: number } = {},
): Promise<PdfScanResult> {
  if (!ocrConfig()) throw ocrUnavailable('Распознавание текста выключено');
  const total = Math.min(numPages, opts.maxPages ?? LIMITS.pdfMaxPages);
  const maxPixels = opts.maxPixels ?? LIMITS.ocrMaxPixels;
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? OCR_SCAN_TIMEOUT_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  const { getDocumentProxy, extractImages } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const perPage: RawLine[][] = Array.from({ length: total }, () => []);
  let next = 1;
  let ok = 0;
  let failed = 0;
  let lastErr: unknown;
  const worker = async () => {
    for (;;) {
      const page = next++;
      if (page > total) return;
      try {
        if (signal.aborted) throw ocrUnavailable('Распознавание текста не уложилось во время');
        const images = await extractImages(pdf, page);
        const best = images.sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (!best) throw new AppError('ocr_failed', 'На странице нет картинки', 422);
        if (best.width * best.height > maxPixels) throw new AppError('ocr_failed', 'Картинка страницы больше 20 Мпикс', 422);
        const png = encodePng(best.data, best.width, best.height, best.channels);
        perPage[page - 1] = await recognizeText(png, 'image/png', name, { signal, page });
        ok++;
      } catch (e) {
        failed++;
        lastErr = e;
        console.warn('ocr: страница скана не распознана', page, e instanceof AppError ? e.code : 'error');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(OCR_SCAN_CONCURRENCY, total) }, worker));
  if (ok === 0) throw lastErr instanceof AppError ? lastErr : ocrUnavailable();
  return { lines: perPage.flat(), pagesOk: ok, pagesFailed: failed };
}
