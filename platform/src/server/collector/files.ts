import { AppError } from '../errors';
import { buildDoc, type RawLine } from './doc';
import { pdfPagesToLines } from './hidden-text';
import { LIMITS } from './limits';
import { parseInWorker } from './parse-worker';
import type { ExtractedDoc, SourceKind } from './types';

export type FileKind = 'pdf' | 'docx';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Тип файла по содержимому, а не по заявленному mime: `%PDF-` или ZIP + `.docx`
 * (+ наличие `word/document.xml` в первых байтах не гарантировано — проверит mammoth).
 */
export function detectFileKind(buf: Buffer, filename: string, mime: string): FileKind | null {
  const head = buf.subarray(0, 1024).toString('latin1');
  if (head.includes('%PDF-')) return 'pdf';
  const isZip = buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (isZip && (/\.docx$/i.test(filename) || mime === DOCX_MIME)) return 'docx';
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

/**
 * PDF (unpdf) и DOCX (mammoth) ≤ 5 МБ, ≤ 20 стр.; координаты `file#pN:lM`.
 * Разбор — в worker_threads с таймаутом. Скрытый текст PDF помечается и не входит в `text`.
 */
export async function extractFile(
  buf: Buffer,
  filename: string,
  mime: string,
  opts: { sourceKind?: SourceKind; origin?: string } = {},
): Promise<ExtractedDoc> {
  if (buf.length === 0) throw new AppError('bad_request', 'Пустой файл', 400);
  if (buf.length > LIMITS.fileMaxBytes) {
    throw new AppError('payload_too_large', 'Файл больше 5 МБ', 413);
  }
  const name = safeFilename(filename);
  const kind = detectFileKind(buf, name, mime);
  if (!kind) throw new AppError('unsupported_media_type', 'Поддерживаются только PDF и DOCX', 415);

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
  if (lines.length === 0) {
    meta.empty = true; // скан без текстового слоя — OCR не делаем
  }

  return buildDoc({
    sourceKind: opts.sourceKind ?? 'resume',
    title: name,
    origin: opts.origin ?? name,
    lines,
    meta,
  });
}
