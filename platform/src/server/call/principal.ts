import { errors } from '../errors';
import { getSession } from '../session';
import type { CallPrincipal } from './access';

/** Кто смотрит созвон: кандидат (своё) или работодатель (по правилам access.ts). 401 без входа. */
export function callPrincipal(req: Request): CallPrincipal {
  const s = getSession(req);
  if (!s) throw errors.unauthorized();
  if (s.candidateId) return { role: 'candidate', candidateId: s.candidateId, userId: s.userId };
  if (s.employerProfileId) return { role: 'employer', userId: s.userId, employerProfileId: s.employerProfileId };
  throw errors.forbidden('Доступно кандидату или работодателю');
}
