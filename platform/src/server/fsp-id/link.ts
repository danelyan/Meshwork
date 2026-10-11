import type { Prisma } from '@prisma/client';

import { fspDemoDoc, type FspAchievement, type FspState } from '@/server/collector/fsp-demo';
import { prisma } from '@/server/db';

import type { FspProviderMode } from './client';
import type { FspRegistryResult } from './registry';

/**
 * Привязка ФСП ID к профилю без изменения схемы: состояние – `Candidate.fspState` (как раньше),
 * идентичность участника – источник `Source(kind = fsp, origin = "fsp:<sub>", ownershipVerified = true)`
 * со снимком `ExtractedDoc` (в `meta`: fspSubject, fspName, achievements на момент привязки). Владение подтверждено
 * проверенным ID-токеном – поэтому `ownershipVerified`. Прежние ФСП-источники кандидата теряют этот флаг.
 *
 * Уникальность «один sub – один кандидат» на стенде намеренно не вводится: три демо-участника общие
 * для всех, кто проверяет стенд. В проде её нужно включить (иначе чужую историю можно привязать дважды).
 */

export interface FspLinkView {
  state: FspState;
  subject: string | null;
  name: string | null;
  achievements: FspAchievement[];
}

export async function linkFspSubject(
  candidateId: string,
  who: { fspId: string; name: string | null },
  registry: FspRegistryResult,
  via: FspProviderMode = 'mock',
): Promise<FspLinkView> {
  const { state } = registry;
  const name = who.name ? who.name.slice(0, 120) : null;
  const doc = fspDemoDoc(candidateId, state, { sub: who.fspId, name: name ?? undefined, achievements: registry.achievements, via: via === 'external' ? 'fsp-id-simulator' : 'fsp-id-mock' });
  const origin = doc.origin;
  const snapshot = doc as unknown as Prisma.InputJsonValue;
  await prisma.$transaction(async (tx) => {
    await tx.candidate.update({ where: { id: candidateId }, data: { fspState: state } });
    await tx.source.updateMany({ where: { candidateId, kind: 'fsp', NOT: { origin } }, data: { ownershipVerified: false } });
    const existing = await tx.source.findFirst({ where: { candidateId, kind: 'fsp', origin }, select: { id: true } });
    if (existing) {
      await tx.source.update({ where: { id: existing.id }, data: { snapshot, ownershipVerified: true, fetchedAt: new Date(doc.fetchedAt) } });
    } else {
      await tx.source.create({ data: { candidateId, kind: 'fsp', origin, snapshot, ownershipVerified: true, fetchedAt: new Date(doc.fetchedAt) } });
    }
  });
  return { state, subject: who.fspId, name, achievements: (doc.meta?.achievements as FspAchievement[] | undefined) ?? [] };
}

/** Участник, привязанный через ФСП ID (последний подтверждённый источник), с достижениями из снимка, или null. */
export async function linkedFspSubject(candidateId: string): Promise<{ sub: string; name: string | null; achievements: FspAchievement[] } | null> {
  const row = await prisma.source.findFirst({
    where: { candidateId, kind: 'fsp', ownershipVerified: true },
    orderBy: { fetchedAt: 'desc' },
    select: { snapshot: true },
  });
  const meta = (row?.snapshot as { meta?: { fspSubject?: unknown; fspName?: unknown; achievements?: unknown } } | null | undefined)?.meta;
  if (!meta || typeof meta.fspSubject !== 'string') return null;
  const achievements = Array.isArray(meta.achievements) ? (meta.achievements as FspAchievement[]) : [];
  return { sub: meta.fspSubject, name: typeof meta.fspName === 'string' ? meta.fspName : null, achievements };
}

/** Что показать в настройках кандидата. Без привязки через ФСП ID – только состояние. */
export async function fspLinkView(candidateId: string, state: FspState): Promise<FspLinkView> {
  const linked = state === 'not_linked' ? null : await linkedFspSubject(candidateId);
  if (!linked) return { state, subject: null, name: null, achievements: [] };
  return { state, subject: linked.sub, name: linked.name, achievements: state === 'linked' ? linked.achievements : [] };
}
