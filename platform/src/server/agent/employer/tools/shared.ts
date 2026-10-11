import { z } from 'zod';

import { SPECIALIZATIONS } from '@/lib/directions';
import { errors } from '@/server/errors';
import { listVacancies, type VacancyView } from '@/server/employer';
import { GRADES } from '@/lib/grades';

import type { AgentTool } from '../../types';
import type { EmployerToolContext } from '../types';

// Разнотипные инструменты в одном реестре: вход и выход проверяются Zod-схемой каждого.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type EmployerTool = AgentTool<any, any, EmployerToolContext>;

export const SpecSchema = z.enum(SPECIALIZATIONS);
export const GradeSchema = z.enum(GRADES);
/** Выдача в ленту – коротко: подробности и полный список – в кабинете. */
export const AGENT_RESULT_LIMIT = 10;

/**
 * Потребность для подбора: явная (своя, иначе 404 – чужая неотличима от несуществующей)
 * или единственная активная. Активных несколько – ошибка со списком: модель уточнит.
 */
export async function resolveVacancy(companyId: string, vacancyId?: string | null): Promise<VacancyView> {
  const all = await listVacancies(companyId);
  if (vacancyId) {
    const v = all.find((x) => x.id === vacancyId);
    if (!v) throw errors.notFound('Потребность не найдена');
    return v;
  }
  const active = all.filter((v) => !v.archived);
  if (active.length === 1) return active[0]!;
  if (active.length === 0) throw errors.notFound('Активных потребностей нет – предложи описать потребность (create_need_draft) или искать по всей базе (search_candidates)');
  throw errors.badRequest(
    `Потребностей несколько – уточни, какую: ${active.map((v) => `${v.id} «${v.title}»`).join('; ')}`,
    active.map((v) => ({ id: v.id, title: v.title })),
  );
}
