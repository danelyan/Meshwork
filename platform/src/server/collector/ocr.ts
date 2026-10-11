import { getEnv } from '@/server/env';
import { AppError } from '../errors';
import type { RawLine } from './doc';

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
