// Аудио кандидата: сегменты LPCM 16 бит моно 16 кГц → WAV-файлы в <CALL_DATA_DIR>/calls/<sessionId>/NNN.wav.
// Не в БД (ADR 0003, п. 4). Распознавание — Yandex SpeechKit кусками ≤ 1 МБ (лимит синхронного v1).
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getEnv } from '../env';
import { AppError } from '../errors';
import { STT_MAX_BYTES, STT_SAMPLE_RATE, recognizeYandex, sttMode } from '../stt';

/** Сегмент ответа: до ~94 с речи (3 МБ LPCM). */
export const CALL_SEGMENT_MAX_BYTES = 3 * 1024 * 1024;
/** Сегментов на созвон (защита диска от цикла). */
export const CALL_MAX_SEGMENTS = 40;
const WAV_HEADER = 44;

export function callAudioDir(sessionId: string): { rel: string; abs: string } {
  const rel = `calls/${sessionId}`;
  return { rel, abs: path.resolve(getEnv().CALL_DATA_DIR, rel) };
}

/** RIFF/WAVE заголовок для PCM 16 бит моно. */
export function wavHeader(dataBytes: number, sampleRate = STT_SAMPLE_RATE): Buffer {
  const h = Buffer.alloc(WAV_HEADER);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

const SEGMENT_RE = /^\d{3}\.wav$/;

export async function listSegments(sessionId: string): Promise<string[]> {
  try {
    return (await readdir(callAudioDir(sessionId).abs)).filter((f) => SEGMENT_RE.test(f)).sort();
  } catch {
    return [];
  }
}

/** Сохранить сегмент; вернуть имя файла. Чётная длина PCM обязательна (16 бит). */
/**
 * `mayWrite` — перепроверка права на запись (Г2, ADR 0005) прямо перед записью файла: отзыв согласия,
 * пришедший во время загрузки, не должен оставить файл.
 */
export async function saveSegment(sessionId: string, pcm: Uint8Array, mayWrite?: () => Promise<boolean>): Promise<string> {
  if (pcm.byteLength === 0) throw new AppError('bad_request', 'Пустая запись', 400);
  if (pcm.byteLength > CALL_SEGMENT_MAX_BYTES) throw new AppError('payload_too_large', 'Ответ длиннее полутора минут - раздели его на два', 413);
  const existing = await listSegments(sessionId);
  if (existing.length >= CALL_MAX_SEGMENTS) throw new AppError('call_audio_limit', 'Слишком много записей в одном созвоне', 409);
  const { abs } = callAudioDir(sessionId);
  await mkdir(abs, { recursive: true });
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength - (pcm.byteLength % 2));
  const next = existing.length ? Number(existing[existing.length - 1]!.slice(0, 3)) + 1 : 0;
  const name = `${String(next).padStart(3, '0')}.wav`;
  if (mayWrite && !(await mayWrite())) throw new AppError('call_recording_off', 'Запись голоса отключена в «Моих согласиях» - ответь текстом', 409);
  try {
    await writeFile(path.join(abs, name), Buffer.concat([wavHeader(data.byteLength), data]), { flag: 'wx' });
  } catch (err) {
    // Гонка двух загрузок: обе увидели один список сегментов, вторая упирается в 'wx'.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new AppError('conflict', 'Запись уже сохраняется - повтори через секунду', 409);
    }
    throw err;
  }
  return name;
}

/** Сегмент существует (иначе 404). */
export async function assertSegment(sessionId: string, name: string): Promise<void> {
  if (!SEGMENT_RE.test(name)) throw new AppError('bad_request', 'Неверное имя сегмента', 400);
  try {
    await access(path.join(callAudioDir(sessionId).abs, name));
  } catch {
    throw new AppError('not_found', 'Сегмент записи не найден', 404);
  }
}

export async function readSegmentPcm(sessionId: string, name: string): Promise<Buffer> {
  if (!SEGMENT_RE.test(name)) throw new AppError('bad_request', 'Неверное имя сегмента', 400);
  try {
    const buf = await readFile(path.join(callAudioDir(sessionId).abs, name));
    return buf.subarray(WAV_HEADER);
  } catch {
    throw new AppError('not_found', 'Сегмент записи не найден', 404);
  }
}

/** Вся запись кандидата одним WAV: сегменты подряд (формат у всех один). null — записи нет. */
export async function concatRecording(sessionId: string, only?: string): Promise<Buffer | null> {
  const names = only ? [only] : await listSegments(sessionId);
  if (names.length === 0) return null;
  const parts = await Promise.all(names.map((n) => readSegmentPcm(sessionId, n)));
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  return Buffer.concat([wavHeader(total), ...parts]);
}

/**
 * Распознать сегмент: при STT=yandex — SpeechKit кусками ≤ 1 МБ подряд (граница куска может разрезать
 * слово — допустимо для созвона); иначе null — текст пришлёт клиент (Web Speech в браузере).
 */
export async function recognizeSegment(pcm: Uint8Array, signal?: AbortSignal): Promise<string | null> {
  if (sttMode() !== 'yandex') return null;
  const env = getEnv();
  const out: string[] = [];
  for (let off = 0; off < pcm.byteLength; off += STT_MAX_BYTES) {
    const chunk = pcm.subarray(off, Math.min(pcm.byteLength, off + STT_MAX_BYTES));
    if (chunk.byteLength < STT_SAMPLE_RATE * 2 * 0.2) continue; // хвост < 0,2 с
    const text = await recognizeYandex(chunk, { apiKey: env.YANDEX_API_KEY as string, folderId: env.YANDEX_FOLDER_ID, signal });
    if (text) out.push(text);
  }
  return out.join(' ').trim();
}
