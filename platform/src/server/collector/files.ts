import { AppError } from '../errors';
import { buildDoc, type RawLine } from './doc';
import { pdfPagesToLines } from './hidden-text';
import { LIMITS } from './limits';
import { recognizeText } from './ocr';
import { parseInWorker } from './parse-worker';
import type { ExtractedDoc, SourceKind } from './types';

export type FileKind = 'pdf' | 'docx' | 'text' | 'image';

/** Картинка, которую принимает Vision OCR (JPEG, PNG — по магическим байтам). */
export type ImageMime = 'image/jpeg' | 'image/png';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
/** Текстовые форматы (решение владельца 10.10): резюме в Markdown, заметки, таблицы CSV. */
const TEXT_EXT = /\.(md|markdown|txt|csv)$/i;

/** Mime оригинала для хранения и скачивания (GET /api/uploads/:id/file). */
export function fileMime(kind: FileKind, filename: string, buf?: Buffer): string {
  if (kind === 'pdf') return 'application/pdf';
  if (kind === 'image') return (buf && imageMime(buf)) ?? (/\.png$/i.test(filename) ? 'image/png' : 'image/jpeg');
  if (kind === 'docx') return DOCX_MIME;
  if (/\.csv$/i.test(filename)) return 'text/csv';
  if (/\.(md|markdown)$/i.test(filename)) return 'text/markdown';
  return 'text/plain';
}

/** JPEG (`FF D8 FF`) или PNG (8-байтная сигнатура) по содержимому. */
export function imageMime(buf: Buffer): ImageMime | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && png.every((b, i) => buf[i] === b)) return 'image/png';
  return null;
}

/** WebP / HEIC / GIF / BMP / TIFF — Vision OCR их не принимает (только JPEG, PNG, PDF). */
function otherImage(buf: Buffer): boolean {
  const ascii = buf.subarray(0, 16).toString('latin1');
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return true;
  if (ascii.slice(4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|avif)/.test(ascii.slice(8, 12))) return true;
  return ascii.startsWith('GIF8') || ascii.startsWith('BM') || ascii.startsWith('II*\0') || ascii.startsWith('MM\0*');
}

/**
 * Тип файла по содержимому, а не по заявленному mime: `%PDF-`, ZIP + `.docx` или текст (.md/.txt/.csv)
 * (+ наличие `word/document.xml` в первых байтах не гарантировано — проверит mammoth).
 */
export function detectFileKind(buf: Buffer, filename: string, mime: string): FileKind | null {
  const head = buf.subarray(0, 1024).toString('latin1');
  if (head.includes('%PDF-')) return 'pdf';
  if (imageMime(buf)) return 'image';
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (isZip && (/\.docx$/i.test(filename) || mime === DOCX_MIME)) return 'docx';
  // текст — по расширению, но без NUL-байтов: бинарник с чужим расширением сюда не пройдёт
  if (TEXT_EXT.test(filename) && !buf.subarray(0, 8192).includes(0)) return 'text';
  return null;
}

/** Имя файла для ссылок `file#pN:lM`: без пути, управляющих символов и `#`. */
export function safeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const clean = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[#?]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(-120);
  return clean || 'file';
}

/** UTF-8 (с BOM или без), иначе Windows-1251 — так сохраняют «Блокнот» и Excel в русской Windows. */
export function decodeText(buf: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder('windows-1251').decode(buf);
  }
  return text.replace(/^\uFEFF/, '');
}

/**
 * Строки текстового файла с исходной нумерацией (`file#p1:lN` совпадает с номером строки в редакторе).
 * Комментарии HTML в Markdown (`<!-- … -->`) при показе не видны — помечаются скрытыми, как невидимый
 * текст PDF, и в `text` не входят.
 */
export function textLines(text: string, name: string, markdown: boolean): RawLine[] {
  const out: RawLine[] = [];
  let inComment = false;
  text.split(/\r\n|\r|\n/).forEach((rawLine, i) => {
    let visible = '';
    let hidden = '';
    let rest = rawLine;
    while (rest) {
      if (markdown && inComment) {
        const end = rest.indexOf('-->');
        hidden += end < 0 ? rest : rest.slice(0, end);
        if (end < 0) break;
        inComment = false;
        rest = rest.slice(end + 3);
      } else {
        const start = markdown ? rest.indexOf('<!--') : -1;
        visible += start < 0 ? rest : rest.slice(0, start);
        if (start < 0) break;
        inComment = true;
        rest = rest.slice(start + 4);
      }
    }
    const ref = `${name}#p1:l${i + 1}`;
    if (visible.trim()) out.push({ ref, text: visible.trim() });
    if (hidden.trim()) out.push({ ref, text: hidden.trim(), hidden: true });
  });
  return out;
}

/**
 * PDF (unpdf) и DOCX (mammoth) ≤ 5 МБ, ≤ 20 стр.; координаты `file#pN:lM`.
 * Разбор — в worker_threads с таймаутом. Скрытый текст PDF помечается и не входит в `text`.
 */
export async function extractFile(
  buf: Buffer,
  filename: string,
  mime: string,
  opts: { sourceKind?: SourceKind; origin?: string; signal?: AbortSignal } = {},
): Promise<ExtractedDoc> {
  if (buf.length === 0) throw new AppError('bad_request', 'Пустой файл', 400);
  if (buf.length > LIMITS.fileMaxBytes) {
    throw new AppError('payload_too_large', 'Файл больше 5 МБ', 413);
  }
  const name = safeFilename(filename);
  const kind = detectFileKind(buf, name, mime);
  if (!kind) {
    if (otherImage(buf)) {
      throw new AppError('unsupported_media_type', 'Этот формат изображения не поддерживается — сохрани его в JPG или PNG', 415);
    }
    throw new AppError('unsupported_media_type', 'Поддерживаются PDF, DOCX, MD, TXT, CSV, JPG и PNG', 415);
  }
  const base = { sourceKind: opts.sourceKind ?? 'resume', title: name, origin: opts.origin ?? name } as const;

  if (kind === 'image') {
    let lines: RawLine[];
    try {
      lines = await recognizeText(buf, imageMime(buf)!, name, { signal: opts.signal });
    } catch (e) {
      console.warn('ocr: картинка не распознана', e instanceof AppError ? e.code : 'error');
      throw new AppError('ocr_failed', 'Не удалось распознать текст на изображении — пришли PDF/DOCX или вставь текст', 422);
    }
    const meta: Record<string, unknown> = { fileKind: kind, ocr: true };
    if (lines.length === 0) meta.empty = true;
    return buildDoc({ ...base, lines, meta });
  }

  if (kind === 'text') {
    const lines = textLines(decodeText(buf), name, /\.(md|markdown)$/i.test(name));
    const meta: Record<string, unknown> = { fileKind: kind };
    if (lines.length === 0) meta.empty = true;
    return buildDoc({ sourceKind: opts.sourceKind ?? 'resume', title: name, origin: opts.origin ?? name, lines, meta });
  }

  const res = await parseInWorker(kind, buf);
  if (!res.ok) {
    if (res.code === 'too_many_pages') {
      throw new AppError('payload_too_large', `В документе ${res.pages} стр., максимум ${LIMITS.pdfMaxPages}`, 413);
    }
    throw new AppError('parse_failed', 'Не удалось прочитать файл', 422);
  }

  let lines: RawLine[];
  const meta: Record<string, unknown> = { fileKind: kind };
  if (res.kind === 'pdf') {
    lines = pdfPagesToLines(res.pages, name);
    meta.pages = res.numPages;
  } else {
    // DOCX: страниц нет в модели документа — всё на «странице 1», строки по абзацам.
    lines = res.text
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((text, i) => ({ ref: `${name}#p1:l${i + 1}`, text }));
  }
  if (lines.length === 0 && res.kind === 'pdf') {
    // Скан без текстового слоя → OCR. Синхронный Vision принимает PDF только из одной страницы;
    // многостраничный скан и сбой OCR — прежнее поведение (meta.empty) + meta.ocrFailed.
    if (res.numPages === 1) {
      try {
        lines = await recognizeText(buf, 'application/pdf', name, { signal: opts.signal, page: 1 });
        meta.ocr = true;
      } catch (e) {
        console.warn('ocr: скан PDF не распознан', e instanceof AppError ? e.code : 'error');
        meta.ocrFailed = true;
      }
    } else {
      meta.ocrFailed = true;
      meta.ocrReason = 'multipage';
    }
  }
  if (lines.length === 0) meta.empty = true;

  return buildDoc({
    sourceKind: opts.sourceKind ?? 'resume',
    title: name,
    origin: opts.origin ?? name,
    lines,
    meta,
  });
}
