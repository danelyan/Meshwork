// Видео кандидата с камеры в комнате звонка: сегменты WebM → файлы <CALL_DATA_DIR>/calls/<sessionId>/video/NNN-<startMs>.webm.
// Не в БД (ADR 0003, п. 4), доступ — как к аудио (после принятого приглашения). Видео никакая модель не анализирует:
// хранится как материал созвона; имя сегмента несёт смещение от начала созвона (мс) — для сопоставления с транскриптом.
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AppError } from '../errors';
import { callAudioDir } from './audio';

/** Сегмент видео: ~60 с при 300 кбит/с ≈ 2,3 МБ; потолок с запасом. */
export const VIDEO_SEGMENT_MAX_BYTES = 8 * 1024 * 1024;
/** Сегментов видео на созвон (≈ 40 минут). */
export const VIDEO_MAX_SEGMENTS = 40;
export const VIDEO_CONTENT_TYPE = 'video/webm';

const SEGMENT_RE = /^(\d{3})-(\d{1,9})\.webm$/;

export function callVideoDir(sessionId: string): string {
  return path.join(callAudioDir(sessionId).abs, 'video');
}

export interface VideoSegment {
  name: string;
  /** Смещение начала сегмента от начала созвона, мс. */
  startMs: number;
}

export function parseVideoName(name: string): VideoSegment | null {
  const m = SEGMENT_RE.exec(name);
  return m ? { name, startMs: Number(m[2]) } : null;
}

export async function listVideoSegments(sessionId: string): Promise<VideoSegment[]> {
  try {
    return (await readdir(callVideoDir(sessionId)))
      .map(parseVideoName)
      .filter((s): s is VideoSegment => s !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function saveVideoSegment(sessionId: string, bytes: Uint8Array, startMs: number): Promise<VideoSegment> {
  if (bytes.byteLength === 0) throw new AppError('bad_request', 'Пустой сегмент видео', 400);
  if (bytes.byteLength > VIDEO_SEGMENT_MAX_BYTES) throw new AppError('payload_too_large', 'Сегмент видео слишком большой', 413);
  const existing = await listVideoSegments(sessionId);
  if (existing.length >= VIDEO_MAX_SEGMENTS) throw new AppError('call_video_limit', 'Слишком много видео в одном созвоне', 409);
  const dir = callVideoDir(sessionId);
  await mkdir(dir, { recursive: true });
  const next = existing.length ? Number(existing[existing.length - 1]!.name.slice(0, 3)) + 1 : 0;
  const name = `${String(next).padStart(3, '0')}-${Math.max(0, Math.floor(startMs))}.webm`;
  try {
    await writeFile(path.join(dir, name), bytes, { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new AppError('conflict', 'Сегмент уже сохраняется - повтори через секунду', 409);
    throw err;
  }
  return { name, startMs: Math.max(0, Math.floor(startMs)) };
}

export async function readVideoSegment(sessionId: string, name: string): Promise<Buffer> {
  if (!SEGMENT_RE.test(name)) throw new AppError('bad_request', 'Неверное имя сегмента', 400);
  try {
    await access(path.join(callVideoDir(sessionId), name));
    return await readFile(path.join(callVideoDir(sessionId), name));
  } catch {
    throw new AppError('not_found', 'Сегмент видео не найден', 404);
  }
}
