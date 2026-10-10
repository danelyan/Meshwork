import { z } from 'zod';

import { ContactSchema } from '../contact';
import { prisma } from '../db';
import { errors } from '../errors';
import { checkInn } from '../onboarding/inn';

/** Пределы совпадают с шагами онбординга работодателя (scenario.ts), чтобы одни и те же данные проходили оба пути. */
export const COMPANY_LIMITS = { name: 120, description: 600, industry: 80 } as const;

/** Необязательный текст: пустая строка и null стирают значение. */
const clearableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не длиннее ${max} символов`)
    .nullable()
    .transform((v) => (v ? v : null));

const InnField = z
  .string()
  .trim()
  .nullable()
  .transform((v, ctx) => {
    const raw = (v ?? '').replace(/\s+/g, '');
    if (!raw) return null;
    const c = checkInn(raw);
    if (!c.ok) {
      ctx.issues.push({ code: 'custom', message: c.reason, input: v });
      return z.NEVER;
    }
    return raw;
  });

/** Пустая строка и null стирают контакт; иначе почта или Telegram (ContactSchema со своим текстом ошибки). */
const ContactField = z.string().trim().nullable().transform((v, ctx) => {
  if (!v) return null;
  const r = ContactSchema.safeParse(v);
  if (!r.success) {
    ctx.issues.push({ code: 'custom', message: r.error.issues[0]?.message ?? 'Некорректный контакт', input: v });
    return z.NEVER;
  }
  return r.data;
});

/** PATCH /api/employer/company: частичная правка; неизвестные поля отвергаются, пустой запрос — тоже. */
export const CompanyPatch = z
  .strictObject({
    name: z.string().trim().min(2, 'Название не короче 2 символов').max(COMPANY_LIMITS.name, `Не длиннее ${COMPANY_LIMITS.name} символов`),
    description: clearableText(COMPANY_LIMITS.description),
    industry: clearableText(COMPANY_LIMITS.industry),
    inn: InnField,
    contact: ContactField,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { error: 'Нет полей для изменения' });
export type CompanyPatch = z.infer<typeof CompanyPatch>;

export interface CompanyView {
  id: string;
  name: string;
  description: string | null;
  industry: string | null;
  inn: string | null;
  contact: string | null;
}

const SELECT = { id: true, name: true, description: true, industry: true, inn: true, contact: true } as const;

/** Профиль своей компании. companyId берётся из профиля работодателя в сессии, не из запроса. */
export async function getCompany(companyId: string): Promise<CompanyView> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: SELECT });
  if (!c) throw errors.notFound('Компания не найдена');
  return c;
}

/** Правит только переданные поля своей компании. */
export async function updateCompany(companyId: string, patch: CompanyPatch): Promise<CompanyView> {
  await getCompany(companyId);
  return prisma.company.update({ where: { id: companyId }, data: patch, select: SELECT });
}
