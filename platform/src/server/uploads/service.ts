import { prisma } from '@/server/db';
import { errors } from '@/server/errors';

import { removeOriginal } from './storage';

/**
 * Удаление материалов кандидата (файл или ссылка). Правило для утверждений из удаляемого
 * источника: неподтверждённые (`proposed`) удаляются вместе с ним; подтверждённые, исправленные
 * и отклонённые остаются – это уже решение человека (отклонённое ещё и не даёт предложить его снова).
 */
export interface DeleteResult {
  deletedClaims: number;
  keptClaims: number;
}

/** Ссылки, которые можно удалить из колонки (как в loadCandidateDocs). */
export const DELETABLE_SOURCE_KINDS = ['url', 'github', 'codeforces', 'stackoverflow'] as const;

function lineRefs(json: unknown): string[] {
  const lines = (json as { lines?: { ref?: unknown }[] } | null)?.lines;
  if (!Array.isArray(lines)) return [];
  return lines.map((l) => l?.ref).filter((r): r is string => typeof r === 'string');
}

export async function deleteUpload(candidateId: string, uploadId: string): Promise<DeleteResult> {
  const u = await prisma.upload.findFirst({
    where: { id: uploadId, candidateId },
    select: { id: true, filename: true, extracted: true, storageKey: true },
  });
  if (!u) throw errors.notFound('Файл не найден');
  // sourceRef утверждений из файла – "<filename>#p1:l3". Другой файл с тем же именем
  // (новая версия резюме) даёт те же ссылки – тогда черновики не трогаем, чтобы не снести чужие.
  const twin = await prisma.upload.count({ where: { candidateId, filename: u.filename, id: { not: u.id } } });
  const refs = lineRefs(u.extracted);
  const match = { candidateId, OR: [{ sourceRef: { startsWith: `${u.filename}#` } }, ...(refs.length ? [{ sourceRef: { in: refs } }] : [])] };
  const [deleted, kept] = await prisma.$transaction(async (tx) => {
    const del = twin ? { count: 0 } : await tx.claim.deleteMany({ where: { ...match, status: 'proposed' } });
    const keep = await tx.claim.count({ where: { ...match, status: { in: ['confirmed', 'edited'] } } });
    await tx.upload.delete({ where: { id: u.id } });
    return [del.count, keep] as const;
  });
  if (u.storageKey) {
    await removeOriginal(u.storageKey).catch((err: unknown) => console.warn('[uploads] remove failed', err instanceof Error ? err.message : err));
  }
  return { deletedClaims: deleted, keptClaims: kept };
}

export async function deleteSource(candidateId: string, sourceId: string): Promise<DeleteResult> {
  const s = await prisma.source.findFirst({
    where: { id: sourceId, candidateId, kind: { in: [...DELETABLE_SOURCE_KINDS] } },
    select: { id: true, origin: true, snapshot: true },
  });
  if (!s) throw errors.notFound('Ссылка не найдена');
  const refs = lineRefs(s.snapshot);
  const match = {
    candidateId,
    OR: [{ sourceId: s.id }, { sourceRef: { startsWith: `${s.origin}#` } }, ...(refs.length ? [{ sourceRef: { in: refs } }] : [])],
  };
  return prisma.$transaction(async (tx) => {
    const del = await tx.claim.deleteMany({ where: { ...match, status: 'proposed' } });
    const kept = await tx.claim.count({ where: { ...match, status: { in: ['confirmed', 'edited'] } } });
    // Claim.source – onDelete: SetNull: оставшиеся утверждения теряют только ссылку на снимок.
    await tx.source.delete({ where: { id: s.id } });
    return { deletedClaims: del.count, keptClaims: kept };
  });
}
