// Аудио созвонов (ADR 0005): удаление при отзыве согласия на запись (Г2) и по сроку хранения
// CALL_RECORDING_RETENTION_DAYS. Удаляются файлы <CALL_DATA_DIR>/calls/<id> (вместе с дорожкой работодателя живой
// защиты calls/<id>/employer, ADR 0008 п. 3) и CallSession.audioPath/employerAudioPath;
// транскрипт, оценки и ссылки audioRef в транскрипте остаются (по ним запись больше не отдаётся: 404).
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

import { ownedDirectory } from '../auth/erase-account';
import { prisma } from '../db';
import { getSetting } from '../admin/settings';
import { getEnv } from '../env';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Удалить аудио созвонов. Ошибка ФС по одному созвону не останавливает остальные и не отменяет отзыв:
 * `audioPath` обнуляется всегда (запись больше не отдаётся), сбой пишется в лог для ручной уборки.
 */
async function removeAudio(ids: readonly string[]): Promise<number> {
  const root = resolve(getEnv().CALL_DATA_DIR, 'calls');
  for (const id of ids) {
    try {
      await rm(ownedDirectory(root, id), { recursive: true, force: true });
    } catch (err) {
      console.error(`[consent] audio of call ${id} not removed:`, err instanceof Error ? err.message : err);
    }
  }
  if (ids.length) await prisma.callSession.updateMany({ where: { id: { in: [...ids] } }, data: { audioPath: null, employerAudioPath: null } });
  return ids.length;
}

/** Удалить один сегмент (запись пришлась на момент отзыва Г2). Ошибка ФС – только в лог. */
export async function removeSegment(sessionId: string, name: string): Promise<void> {
  const root = resolve(getEnv().CALL_DATA_DIR, 'calls');
  try {
    await rm(resolve(ownedDirectory(root, sessionId), name), { force: true });
  } catch (err) {
    console.error(`[consent] segment ${sessionId}/${name} not removed:`, err instanceof Error ? err.message : err);
  }
}

/** Все аудиозаписи кандидата (отзыв Г2). Каталог удаляется и у созвонов без audioPath – на случай гонки записи. */
export async function deleteCandidateRecordings(candidateId: string): Promise<number> {
  const calls = await prisma.callSession.findMany({ where: { candidateId }, select: { id: true, audioPath: true } });
  await removeAudio(calls.map((c) => c.id));
  return calls.filter((c) => c.audioPath).length;
}

/** Граница срока: созвоны, начатые раньше, теряют аудио. */
export function retentionCutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** Очистка по сроку хранения. Активные созвоны не трогает. Возвращает число очищенных созвонов. */
export async function purgeExpiredRecordings(now = new Date(), days?: number): Promise<number> {
  days ??= await getSetting('call.recordingRetentionDays');
  const calls = await prisma.callSession.findMany({
    where: { OR: [{ audioPath: { not: null } }, { employerAudioPath: { not: null } }], status: { not: 'active' }, startedAt: { lt: retentionCutoff(now, days) } },
    select: { id: true },
  });
  return removeAudio(calls.map((c) => c.id));
}

type JobState = { timer: ReturnType<typeof setInterval> | null; running: boolean };
const KEY = Symbol.for('fsp.recordingRetentionJob');
const g = globalThis as unknown as Record<symbol, JobState | undefined>;

/** Один прогон с защитой от наложения (прошлый ещё идёт – пропускаем). */
export async function runRetentionOnce(now = new Date()): Promise<number | null> {
  const st = (g[KEY] ??= { timer: null, running: false });
  if (st.running) return null;
  st.running = true;
  try {
    const n = await purgeExpiredRecordings(now);
    if (n > 0) console.info(`[retention] audio removed from ${n} call(s)`);
    return n;
  } catch (err) {
    console.warn('[retention] failed:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    st.running = false;
  }
}

/**
 * Фоновая очистка: при старте сервера и раз в сутки (вызов – src/instrumentation.ts). Повторный вызов в том же
 * процессе (HMR, второй register) второй таймер не заводит. Таймер unref – не держит процесс.
 */
export function startRecordingRetentionJob(intervalMs = DAY_MS): boolean {
  const st = (g[KEY] ??= { timer: null, running: false });
  if (st.timer) return false;
  st.timer = setInterval(() => void runRetentionOnce(), intervalMs);
  st.timer.unref?.();
  void runRetentionOnce();
  return true;
}
