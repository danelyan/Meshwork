import { z } from 'zod';

import { ListBase, oneOf } from './lib';

/**
 * Параметры запроса обзорных списков админки (E-08, фаза 1). Отдельный лёгкий модуль без БД и `server-only`:
 * генератор OpenAPI (scripts/openapi) импортирует схемы по пути из маршрута, а под vitest алиас `@/` не
 * разрешается, поэтому схема в модуле с `@/server/db` пропала бы из спецификации.
 */

const SPECS = ['backend', 'frontend', 'ai', 'engineering'] as const;
const GRADES = ['junior', 'middle', 'senior'] as const;
const TRI = ['yes', 'no'] as const;
const INV_STATUSES = ['sent', 'viewed', 'accepted', 'declined', 'hired', 'withdrawn', 'closed_hired'] as const;

export const UserListQuery = ListBase.extend({
  role: oneOf(['pending', 'candidate', 'employer'] as const),
  blocked: oneOf(TRI),
  demo: oneOf(TRI),
});

export const CandidateListQuery = ListBase.extend({
  specialization: oneOf(SPECS),
  grade: oneOf(GRADES),
  fsp: oneOf(['not_linked', 'no_achievements', 'unavailable', 'linked'] as const),
  hidden: oneOf(TRI),
  demo: oneOf(TRI),
});

export const CompanyListQuery = ListBase.extend({
  verified: oneOf(['yes', 'no', 'requested'] as const),
  blocked: oneOf(TRI),
});

export const VacancyListQuery = ListBase.extend({
  specialization: oneOf(SPECS),
  grade: oneOf(GRADES),
  state: oneOf(['active', 'archived'] as const),
  companyId: z.string().max(64).optional().catch(undefined),
});

export const InvitationListQuery = ListBase.extend({
  status: oneOf(INV_STATUSES),
  complaint: oneOf(['yes'] as const),
  companyId: z.string().max(64).optional().catch(undefined),
  candidateId: z.string().max(64).optional().catch(undefined),
});

export const ApplicationListQuery = ListBase.extend({
  status: oneOf(['sent', 'viewed', 'accepted', 'declined', 'closed'] as const),
  vacancyId: z.string().max(64).optional().catch(undefined),
});
