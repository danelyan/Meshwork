import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * Безопасная распаковка .tar.gz без внешних утилит и зависимостей.
 * Отказ всего архива: симлинки и жёсткие ссылки, устройства и FIFO, абсолютные пути, `..`,
 * `\` и NUL в именах, битая контрольная сумма, превышение лимитов (gzip-бомба режется
 * `maxOutputLength`). Пропускаются (не отказ): `node_modules/` и `.git/` – зависимости
 * кандидату не ставятся, история не нужна.
 */

export class ArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveError';
  }
}

export interface ExtractLimits {
  maxUncompressedBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxDepth: number;
}

export const DEFAULT_EXTRACT_LIMITS: ExtractLimits = {
  maxUncompressedBytes: 150 * 1024 * 1024,
  maxFiles: 5_000,
  maxFileBytes: 20 * 1024 * 1024,
  maxDepth: 24,
};

export interface TarEntry {
  path: string;
  type: 'file' | 'dir';
  data?: Buffer;
}

export interface ParsedArchive {
  entries: TarEntry[];
  /** Комментарий pax_global_header: GitHub пишет туда SHA коммита. */
  comment?: string;
  skipped: number;
  bytes: number;
}

const BLOCK = 512;
const SKIP_SEGMENTS = new Set(['node_modules', '.git']);

function cstr(buf: Buffer, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const nul = slice.indexOf(0);
  return slice.subarray(0, nul === -1 ? slice.length : nul).toString('utf8');
}

function parseSize(buf: Buffer, start: number, len: number): number {
  const field = buf.subarray(start, start + len);
  if (field[0]! & 0x80) {
    // base-256 (GNU) для больших файлов: такие нам всё равно не нужны.
    throw new ArchiveError('слишком большой файл в архиве');
  }
  const s = cstr(buf, start, len).trim();
  if (s === '') return 0;
  if (!/^[0-7]+$/.test(s)) throw new ArchiveError('битый заголовок tar (размер)');
  return parseInt(s, 8);
}

function checksumOk(header: Buffer): boolean {
  const stored = cstr(header, 148, 8).trim();
  if (!/^[0-7]+$/.test(stored)) return false;
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  return sum === parseInt(stored, 8);
}

function parsePax(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    if (space === -1) break;
    const len = Number(data.subarray(pos, space).toString('ascii'));
    if (!Number.isInteger(len) || len <= 0 || pos + len > data.length) throw new ArchiveError('битый pax-заголовок');
    const record = data.subarray(space + 1, pos + len - 1).toString('utf8');
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

/** Нормализация пути записи. Бросает ArchiveError на опасный путь. */
export function normalizeEntryPath(raw: string, maxDepth = DEFAULT_EXTRACT_LIMITS.maxDepth): string[] {
  if (raw.includes('\0') || raw.includes('\\')) throw new ArchiveError(`недопустимое имя: ${JSON.stringify(raw.slice(0, 80))}`);
  if (raw.startsWith('/')) throw new ArchiveError(`абсолютный путь в архиве: ${raw.slice(0, 80)}`);
  const parts = raw.split('/').filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..')) throw new ArchiveError(`путь за пределы каталога: ${raw.slice(0, 80)}`);
  if (parts.length > maxDepth) throw new ArchiveError('слишком глубокая вложенность');
  if (parts.some((p) => Buffer.byteLength(p) > 255)) throw new ArchiveError('слишком длинное имя');
  return parts;
}

export function parseTarGz(gz: Buffer, limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS): ParsedArchive {
  let tar: Buffer;
  try {
    tar = gunzipSync(gz, { maxOutputLength: limits.maxUncompressedBytes });
  } catch (err) {
    if (err instanceof RangeError || (err as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') {
      throw new ArchiveError('архив больше лимита после распаковки');
    }
    throw new ArchiveError('не gzip-архив');
  }
  return parseTar(tar, limits);
}

export function parseTar(tar: Buffer, limits: ExtractLimits = DEFAULT_EXTRACT_LIMITS): ParsedArchive {
  const raw: { parts: string[]; type: 'file' | 'dir'; data?: Buffer }[] = [];
  let comment: string | undefined;
  let nextPath: string | undefined;
  let skipped = 0;
  let bytes = 0;
  let pos = 0;

  while (pos + BLOCK <= tar.length) {
    const header = tar.subarray(pos, pos + BLOCK);
    if (header.every((b) => b === 0)) break; // конец архива
    if (!checksumOk(header)) throw new ArchiveError('битый заголовок tar (контрольная сумма)');
    const type = String.fromCharCode(header[156]!);
    const size = parseSize(header, 124, 12);
    const dataStart = pos + BLOCK;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new ArchiveError('обрезанный архив');
    const data = tar.subarray(dataStart, dataEnd);
    pos = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === 'g') {
      const pax = parsePax(data);
      if (pax.comment) comment = pax.comment.trim();
      continue;
    }
    if (type === 'x') {
      const pax = parsePax(data);
      if (pax.linkpath !== undefined) throw new ArchiveError('ссылки в архиве запрещены');
      if (pax.path) nextPath = pax.path;
      continue;
    }
    if (type === 'L') {
      nextPath = cstr(data, 0, data.length);
      continue;
    }
    if (type === 'K') throw new ArchiveError('ссылки в архиве запрещены');

    const ustarPrefix = cstr(header, 257, 6) === 'ustar' ? cstr(header, 345, 155) : '';
    const name = nextPath ?? (ustarPrefix ? `${ustarPrefix}/${cstr(header, 0, 100)}` : cstr(header, 0, 100));
    nextPath = undefined;

    if (type === '1' || type === '2') throw new ArchiveError(`ссылка в архиве запрещена: ${name.slice(0, 80)}`);
    if (type !== '0' && type !== '\0' && type !== '7' && type !== '5') {
      throw new ArchiveError(`недопустимый тип записи «${type}»: ${name.slice(0, 80)}`);
    }
    const parts = normalizeEntryPath(name, limits.maxDepth);
    if (parts.length === 0) continue;
    if (type === '5') {
      raw.push({ parts, type: 'dir' });
      continue;
    }
    if (size > limits.maxFileBytes) throw new ArchiveError(`файл больше лимита: ${name.slice(0, 80)}`);
    bytes += size;
    if (bytes > limits.maxUncompressedBytes) throw new ArchiveError('архив больше лимита после распаковки');
    raw.push({ parts, type: 'file', data: Buffer.from(data) });
    if (raw.length > limits.maxFiles * 2) throw new ArchiveError('слишком много файлов');
  }

  // GitHub кладёт всё в <owner>-<repo>-<sha>/ – снимаем общий верхний каталог.
  const tops = new Set(raw.map((e) => e.parts[0]));
  const strip = tops.size === 1 && raw.some((e) => e.parts.length > 1) && raw.every((e) => e.parts.length > 1 || e.type === 'dir');

  const entries: TarEntry[] = [];
  let files = 0;
  for (const e of raw) {
    const parts = strip ? e.parts.slice(1) : e.parts;
    if (parts.length === 0) continue;
    if (parts.some((p) => SKIP_SEGMENTS.has(p))) {
      skipped++;
      continue;
    }
    if (e.type === 'file' && ++files > limits.maxFiles) throw new ArchiveError('слишком много файлов');
    entries.push({ path: parts.join('/'), type: e.type, data: e.data });
  }
  return { entries, comment, skipped, bytes };
}

/** Записать записи в destDir. Каталоги 0755, файлы 0644; симлинков не создаёт. */
export async function writeEntries(destDir: string, entries: TarEntry[]): Promise<void> {
  const root = path.resolve(destDir);
  await mkdir(root, { recursive: true, mode: 0o755 });
  for (const e of entries) {
    const target = path.resolve(root, e.path);
    if (target !== root && !target.startsWith(root + path.sep)) throw new ArchiveError('путь за пределы каталога');
    if (e.type === 'dir') {
      await mkdir(target, { recursive: true, mode: 0o755 });
    } else {
      await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, e.data ?? Buffer.alloc(0), { mode: 0o644 });
    }
  }
}
