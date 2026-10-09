import { prisma } from '../db';
import { errors } from '../errors';

export interface EmployerContext {
  employerProfileId: string;
  companyId: string;
  companyName: string;
  companyDescription: string | null;
}

/** Компания работодателя по профилю из куки. Профиль удалён — 403 (кука устарела). */
export async function loadEmployerContext(employerProfileId: string): Promise<EmployerContext> {
  const p = await prisma.employerProfile.findUnique({
    where: { id: employerProfileId },
    select: { id: true, company: { select: { id: true, name: true, description: true } } },
  });
  if (!p) throw errors.forbidden('Профиль работодателя не найден');
  return { employerProfileId: p.id, companyId: p.company.id, companyName: p.company.name, companyDescription: p.company.description };
}
