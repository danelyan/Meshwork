import type { Prisma } from '@prisma/client';

import { prisma } from '../db';
import type { ExtractedDoc, ProfileKind } from './types';

/**
 * Кэш профилей на 24 ч: память процесса + таблица Source (снимок — тот же
 * ExtractedDoc). Публичные данные профиля, поэтому снимок одного кандидата годится
 * как кэш для того же origin у другого; в Source пишем только с candidateId.
 */
export const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;

const memory = new Map<string, { doc: ExtractedDoc; at: number }>();

export function resetProfileCache() {
  memory.clear();
}

export async function readCache(kind: ProfileKind, origin: string, now = Date.now()): Promise<ExtractedDoc | null> {
  const k = `${kind}|${origin}`;
  const hit = memory.get(k);
  if (hit && now - hit.at < PROFILE_TTL_MS) return hit.doc;
  try {
    const row = await prisma.source.findFirst({
      where: { kind, origin, fetchedAt: { gte: new Date(now - PROFILE_TTL_MS) } },
      orderBy: { fetchedAt: 'desc' },
      select: { snapshot: true, fetchedAt: true },
    });
    if (!row) return null;
    const doc = row.snapshot as unknown as ExtractedDoc;
    memory.set(k, { doc, at: row.fetchedAt.getTime() });
    return doc;
  } catch {
    return null; // БД недоступна — читаем из сети
  }
}

export function writeMemory(kind: ProfileKind, origin: string, doc: ExtractedDoc, now = Date.now()) {
  memory.set(`${kind}|${origin}`, { doc, at: now });
}

/** Снимок в Source кандидата (обновляет существующий для того же kind+origin). */
export async function saveSource(candidateId: string, kind: ProfileKind, origin: string, doc: ExtractedDoc): Promise<string> {
  const snapshot = doc as unknown as Prisma.InputJsonValue;
  const existing = await prisma.source.findFirst({ where: { candidateId, kind, origin }, select: { id: true } });
  if (existing) {
    await prisma.source.update({ where: { id: existing.id }, data: { snapshot, fetchedAt: new Date(doc.fetchedAt) } });
    return existing.id;
  }
  const row = await prisma.source.create({
    data: { candidateId, kind, origin, snapshot, fetchedAt: new Date(doc.fetchedAt) },
    select: { id: true },
  });
  return row.id;
}
