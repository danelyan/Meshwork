import { z } from 'zod';

import { CompanyPatch, getCompany } from '@/server/employer/company';
import { errors } from '@/server/errors';

import type { CompanyDraft } from '../types';

import type { EmployerTool } from './shared';

const Input = z.object({
  name: z.string().min(2).max(120).nullable().optional().describe('Новое название; null или пропуск — не менять'),
  industry: z.string().min(2).max(80).nullable().optional().describe('Отрасль'),
  description: z.string().min(20).max(2000).nullable().optional().describe('Описание компании для кандидата'),
  contact: z.string().min(3).max(200).nullable().optional().describe('Способ связи, который увидит кандидат в приглашении'),
  rationale: z.string().min(3).max(300).describe('Одной фразой: что и почему предлагаешь изменить'),
});
const Output = z.object({
  drafted: z.literal(true),
  name: z.string().nullable(),
  industry: z.string().nullable(),
  description: z.string().nullable(),
  contact: z.string().nullable(),
  current: z.object({ name: z.string(), industry: z.string().nullable(), description: z.string().nullable(), contact: z.string().nullable() }),
  rationale: z.string(),
});

const FIELDS = ['name', 'industry', 'description', 'contact'] as const;

/**
 * Черновик профиля компании (CompanyDraft → событие company_draft). Ничего не сохраняет: применяет человек
 * кнопкой → PATCH /api/employer/company. Проверка — той же схемой CompanyPatch (длины, формат контакта), чтобы
 * предложенное гарантированно прошло при «Применить». В результат, помимо drafted, кладётся сам черновик:
 * из сохранённого результата инструмента его восстанавливает лента (restore.ts).
 */
export const draftCompanyProfile: EmployerTool = {
  name: 'draft_company_profile',
  description:
    'Предложить изменения в профиле компании (название, отрасль, описание до 600 символов, способ связи: почта или Telegram), когда работодатель просит дополнить или поправить данные о компании. Передавай только поля, которые меняешь. Ничего не сохраняет: применяет человек кнопкой «Применить». Если от текущих значений ничего не отличается, вернёт ошибку.',
  input: Input,
  output: Output,
  terminal: false,
  async handler(ctx, input: z.infer<typeof Input>): Promise<z.infer<typeof Output>> {
    const company = await getCompany(ctx.companyId);
    const current = { name: company.name, industry: company.industry, description: company.description, contact: company.contact };

    const asked: Record<string, string> = {};
    for (const f of FIELDS) {
      const v = input[f];
      if (v !== null && v !== undefined) asked[f] = v;
    }
    if (!Object.keys(asked).length) throw errors.badRequest('Изменений нет: не передано ни одного поля профиля');

    const parsed = CompanyPatch.safeParse(asked);
    if (!parsed.success) throw errors.badRequest(`Черновик не пройдёт сохранение: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    const patch = parsed.data;

    const next = { name: null, industry: null, description: null, contact: null } as Record<(typeof FIELDS)[number], string | null>;
    for (const f of FIELDS) {
      const v = patch[f];
      if (v !== undefined && v !== null && v !== current[f]) next[f] = v;
    }
    if (FIELDS.every((f) => next[f] === null)) throw errors.badRequest('Изменений нет: предложенные значения совпадают с текущими в профиле');

    const draft: CompanyDraft = { ...next, current, rationale: input.rationale.trim() };
    ctx.emit({ type: 'company_draft', draft });
    return { drafted: true, ...draft };
  },
};
