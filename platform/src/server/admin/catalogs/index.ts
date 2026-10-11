import 'server-only';

import { z } from 'zod';

import { prisma } from '@/server/db';
import { errors } from '@/server/errors';
import { listTemplateViews } from '@/server/project/service';

import { audit, requireReason } from '../audit';
import { getSetting, setCatalogSetting } from '../settings';
import type { StaffContext } from '../session';

/**
 * Справочники платформы (E-08, фаза 4). Правится только то, что безопасно менять без деплоя:
 *  - подкатегории: статус (`active`/`planned`) и порядок; id, направление и название не меняются;
 *  - каталог утверждений: текст (`statement`) и ограничения (`limits`); id, веса, грейды, маркеры не меняются
 *    (на id ссылаются утверждения кандидатов, а веса участвуют в расчёте покрытия);
 *  - шаблоны заданий теста и проектов: публикация/снятие. Поля статуса в схеме нет, поэтому список снятых id
 *    лежит в `PlatformSetting` (`catalog.hiddenTaskTemplates`, `catalog.hiddenProjectTemplates`).
 */

type Actor = Pick<StaffContext, 'staffId' | 'ip'>;

export const SubcategoryPatch = z
  .object({ status: z.enum(['active', 'planned']).optional(), order: z.number().int().min(0).max(1000).optional() })
  .refine((v) => v.status !== undefined || v.order !== undefined, { message: 'Нечего менять' });

export const ClaimPatch = z
  .object({ statement: z.string().trim().min(5).max(500).optional(), limits: z.string().trim().min(1).max(1000).optional() })
  .refine((v) => v.statement !== undefined || v.limits !== undefined, { message: 'Нечего менять' });

export async function listSubcategories() {
  return prisma.subcategory.findMany({ orderBy: [{ specialization: 'asc' }, { order: 'asc' }, { id: 'asc' }] });
}

export async function updateSubcategory(id: string, patch: z.infer<typeof SubcategoryPatch>, actor: Actor, reason: string | null | undefined) {
  const r = requireReason(reason);
  return prisma.$transaction(async (tx) => {
    const before = await tx.subcategory.findUnique({ where: { id } });
    if (!before) throw errors.notFound('Подкатегория не найдена');
    const after = await tx.subcategory.update({ where: { id }, data: { status: patch.status, order: patch.order } });
    await audit({ actor, action: 'edit_catalogs.subcategory', target: { type: 'subcategory', id }, reason: r, before, after }, tx);
    return after;
  });
}

export async function listClaims(filter: { specialization?: string; q?: string } = {}) {
  const q = filter.q?.trim();
  return prisma.claimCatalog.findMany({
    where: {
      ...(filter.specialization ? { specialization: filter.specialization as never } : {}),
      ...(q ? { OR: [{ id: { contains: q, mode: 'insensitive' } }, { statement: { contains: q, mode: 'insensitive' } }] } : {}),
    },
    select: { id: true, specialization: true, statement: true, limits: true, grades: true, weight: true, catalogVersion: true },
    orderBy: { id: 'asc' },
    take: 500,
  });
}

export async function updateClaim(id: string, patch: z.infer<typeof ClaimPatch>, actor: Actor, reason: string | null | undefined) {
  const r = requireReason(reason);
  return prisma.$transaction(async (tx) => {
    const before = await tx.claimCatalog.findUnique({ where: { id }, select: { id: true, statement: true, limits: true } });
    if (!before) throw errors.notFound('Запись каталога не найдена');
    const after = await tx.claimCatalog.update({ where: { id }, data: { statement: patch.statement, limits: patch.limits }, select: { id: true, statement: true, limits: true } });
    await audit({ actor, action: 'edit_catalogs.claim', target: { type: 'claim', id }, reason: r, before, after }, tx);
    return after;
  });
}

export type TemplateKind = 'task' | 'project';

export interface TemplateRow {
  kind: TemplateKind;
  id: string;
  title: string;
  specialization: string;
  grade: string;
  published: boolean;
}

export async function listTemplates(): Promise<TemplateRow[]> {
  const [tasks, hiddenTasks, hiddenProjects] = await Promise.all([
    prisma.taskTemplate.findMany({ select: { id: true, title: true, specialization: true, grade: true }, orderBy: { id: 'asc' } }),
    getSetting('catalog.hiddenTaskTemplates'),
    getSetting('catalog.hiddenProjectTemplates'),
  ]);
  const hiddenT = new Set(hiddenTasks);
  const hiddenP = new Set(hiddenProjects);
  return [
    ...tasks.map((t) => ({ kind: 'task' as const, id: t.id, title: t.title, specialization: t.specialization, grade: t.grade, published: !hiddenT.has(t.id) })),
    ...listTemplateViews().map((t) => ({ kind: 'project' as const, id: t.id, title: t.title, specialization: t.specialization, grade: t.grade, published: !hiddenP.has(t.id) })),
  ];
}

/** Опубликовать или снять шаблон. Идущие попытки и созданные задания не затрагиваются, снятый шаблон не выдаётся в новых. */
export async function setTemplatePublished(kind: TemplateKind, id: string, published: boolean, actor: Actor, reason: string | null | undefined) {
  const r = requireReason(reason);
  const exists = kind === 'task' ? Boolean(await prisma.taskTemplate.findUnique({ where: { id }, select: { id: true } })) : listTemplateViews().some((t) => t.id === id);
  if (!exists) throw errors.notFound('Шаблон не найден');
  const key = kind === 'task' ? 'catalog.hiddenTaskTemplates' : 'catalog.hiddenProjectTemplates';
  const hidden = new Set(await getSetting(key));
  if (published) hidden.delete(id);
  else hidden.add(id);
  await setCatalogSetting(key, [...hidden].sort(), actor, `${published ? 'Публикация' : 'Снятие'} ${id}: ${r}`);
}
