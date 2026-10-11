// Архивы lane project без зависимостей: чтение .tar.gz репозитория кандидата (GitHub tarball) для
// сверки файлов платформы и выдержки кода в рубрику; запись .zip заготовки для кандидата.
import { crc32, gunzipSync, deflateRawSync } from 'node:zlib';

import { AppError } from '../errors';

const MAX_UNPACKED = 200 * 1024 * 1024;
const MAX_FILES = 20_000;

function cstr(buf: Uint8Array, start: number, len: number): string {
  const slice = buf.subarray(start, start + len);
  const end = slice.indexOf(0);
  return Buffer.from(end === -1 ? slice : slice.subarray(0, end)).toString('utf8');
}

function octal(buf: Uint8Array, start: number, len: number): number {
  const s = cstr(buf, start, len).trim();
  return s ? parseInt(s, 8) : 0;
}

function paxPath(data: Uint8Array): string | null {
  const text = Buffer.from(data).toString('utf8');
  const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
  return m ? m[1]! : null;
}

/**
 * Обычные файлы из .tar.gz → путь (без первого каталога, как в GitHub tarball `owner-repo-sha/`) → содержимое.
 * Ссылки, каталоги и служебные записи пропускаются; размер распакованного – до 200 МБ.
 */
export function readTarGz(gz: Uint8Array, opts: { stripFirst?: boolean } = {}): Map<string, Uint8Array> {
  let tar: Buffer;
  try {
    tar = gunzipSync(gz, { maxOutputLength: MAX_UNPACKED });
  } catch {
    throw new AppError('bad_archive', 'Архив репозитория не читается', 400);
  }
  const files = new Map<string, Uint8Array>();
  let off = 0;
  let longName: string | null = null;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = octal(h, 124, 12);
    const type = String.fromCharCode(h[156] ?? 48);
    const prefix = cstr(h, 345, 155);
    let name = longName ?? (prefix ? `${prefix}/${cstr(h, 0, 100)}` : cstr(h, 0, 100));
    const dataStart = off + 512;
    const data = tar.subarray(dataStart, dataStart + size);
    off = dataStart + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      longName = paxPath(data);
      continue;
    }
    if (type === 'L') {
      longName = cstr(data, 0, data.length);
      continue;
    }
    longName = null;
    if (type !== '0' && type !== '\0') continue;
    if (opts.stripFirst !== false) name = name.split('/').slice(1).join('/');
    if (!name || name.split('/').includes('..') || name.startsWith('/')) continue;
    files.set(name, new Uint8Array(data));
    if (files.size > MAX_FILES) throw new AppError('bad_archive', 'Слишком много файлов в репозитории', 400);
  }
  return files;
}

/** .zip (deflate) из текстовых файлов: заготовка проекта для кандидата. */
export function writeZip(entries: { path: string; content: string | Uint8Array }[], rootDir = ''): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(rootDir ? `${rootDir}/${e.path}` : e.path, 'utf8');
    const raw = typeof e.content === 'string' ? Buffer.from(e.content, 'utf8') : Buffer.from(e.content);
    const data = deflateRawSync(raw);
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0x0800, 6); // UTF-8 имена
    lh.writeUInt16LE(8, 8); // deflate
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12); // 1980-01-01: воспроизводимый архив
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(0, 28);
    local.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, name);
    offset += lh.length + name.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}
