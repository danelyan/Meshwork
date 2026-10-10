import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import { getEnv } from '@/server/env';

/**
 * Хранилище оригиналов файлов кандидата на диске: <UPLOAD_DIR>/<candidateId>/<sha256>.
 * Путь собирается только из серверных идентификаторов (id кандидата из сессии и sha256
 * содержимого) — имя файла от пользователя в путь не попадает. Один файл на (кандидат, sha256),
 * как и уникальный ключ Upload: повторная загрузка того же содержимого не плодит копий.
 */

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

export function uploadRoot(): string {
  return resolve(getEnv().UPLOAD_DIR);
}

export function storageKeyFor(candidateId: string, sha256: string): string {
  if (!ID_RE.test(candidateId) || !SHA_RE.test(sha256)) throw new Error('bad storage key parts');
  return `${candidateId}/${sha256}`;
}

/** Абсолютный путь по ключу; ключ чужой формы или выход за корень — ошибка. */
export function pathForKey(key: string): string {
  const [cand, sha, ...rest] = key.split('/');
  if (rest.length || !cand || !sha || !ID_RE.test(cand) || !SHA_RE.test(sha)) throw new Error('bad storage key');
  const root = uploadRoot();
  const p = resolve(join(root, cand, sha));
  if (!p.startsWith(root + sep)) throw new Error('bad storage key');
  return p;
}

/** Сохранить байты (атомарно: временный файл + rename). Уже есть — не переписывать. */
export async function saveOriginal(candidateId: string, sha256: string, buf: Buffer): Promise<string> {
  const key = storageKeyFor(candidateId, sha256);
  const path = pathForKey(key);
  const existing = await stat(path).catch(() => null);
  if (existing?.isFile() && existing.size === buf.length) return key;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, buf, { mode: 0o600 });
  await rename(tmp, path);
  return key;
}

export async function readOriginal(key: string): Promise<Buffer | null> {
  try {
    return await readFile(pathForKey(key));
  } catch {
    return null;
  }
}

export async function removeOriginal(key: string): Promise<void> {
  await rm(pathForKey(key), { force: true });
}

/** Content-Disposition: ASCII-запасное имя без кавычек и слешей + filename* по RFC 5987/6266. */
export function contentDisposition(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, '_').trim().slice(0, 150) || 'file';
  const ascii = clean.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(clean).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
