import { z } from 'zod';

import { SPEC_ROLE } from '@/lib/directions';
import { errors } from '@/server/errors';
import { categoryNeeds, normalizeStack } from '@/server/employer/ranking';
import { loadCatalog } from '@/server/recommend/evidence';
import type { Grade, Specialization } from '@/server/types';

import type { NeedDraft } from '../types';

import { GradeSchema, SpecSchema, type EmployerTool } from './shared';

/** Сколько требований каталога предвыбрать — как форма потребности (VacancyForm DEFAULT_PICK). */
export const NEED_DRAFT_PICK = 6;

/** Метки стека, которые узнаём в описании словами (регистр не важен). */
const STACK_WORDS = [
  'Go', 'Python', 'Java', 'Kotlin', 'C#', 'PHP', 'Node.js', 'TypeScript', 'JavaScript', 'PostgreSQL', 'MySQL', 'MongoDB',
  'Redis', 'Kafka', 'RabbitMQ', 'ClickHouse', 'Docker', 'Kubernetes', 'gRPC', 'GraphQL', 'Django', 'FastAPI', 'Flask',
  'Spring', 'React', 'Vue', 'Angular', 'Next.js', 'Redux', 'Webpack', 'Vite', 'CSS', 'Jest', 'Playwright',
];

export function parseSpecialization(text: string): Specialization | null {
  const t = text.toLowerCase();
  if (/(бэкенд|бекенд|backend|back-end|серверн)/.test(t)) return 'backend';
  if (/(фронтенд|фронт|frontend|front-end|верстк|react|vue|angular)/.test(t)) return 'frontend';
  return null;
}

export function parseGrade(text: string): Grade | null {
  const t = text.toLowerCase();
  if (/(middle|мидл|миддл)/.test(t)) return 'middle';
  if (/(junior|джун|стаж[её]р|начинающ)/.test(t)) return 'junior';
  return null;
}

export function parseStack(text: string): string[] {
  const out: string[] = [];
  for (const w of STACK_WORDS) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // «Go» — только отдельным словом латиницей, иначе ловит «Google», «good».
    if (new RegExp(`(^|[^\\p{L}\\d])${esc}($|[^\\p{L}\\d])`, 'iu').test(text)) out.push(w);
  }
  return out;
}

/** «200–260 тыс», «от 150к», «180 000 – 220 000 ₽» → вилка; одно число — только нижняя граница. */
export function parseSalary(text: string): { from: number | null; to: number | null } {
  const nums: number[] = [];
  const re = /(\d[\d\s]{0,9}\d|\d)\s*(тыс|к\b|k\b|т\.р)?/giu;
  for (const m of text.matchAll(re)) {
    let n = Number(m[1]!.replace(/\s/g, ''));
    if (m[2] || n < 1000) n *= 1000;
    if (n >= 10_000 && n <= 10_000_000) nums.push(n);
  }
  if (!nums.length) return { from: null, to: null };
  const [a, b] = nums;
  if (b === undefined) return { from: a!, to: null };
  return { from: Math.min(a!, b), to: Math.max(a!, b) };
}

const Input = z.object({
  description: z.string().trim().min(5).max(2000).describe('Описание словами работодателя: кто нужен, задачи, стек, вилка'),
  title: z.string().trim().min(3).max(120).optional(),
  specialization: SpecSchema.optional(),
  grade: GradeSchema.optional(),
  stack: z.array(z.string().min(1).max(40)).max(15).optional(),
  salaryFrom: z.number().int().min(0).max(10_000_000).optional(),
  salaryTo: z.number().int().min(0).max(10_000_000).optional(),
});
const Output = z
  .object({
    title: z.string(),
    specialization: SpecSchema,
    grade: GradeSchema,
    stack: z.array(z.string()),
    salaryFrom: z.number().int().nullable(),
    salaryTo: z.number().int().nullable(),
    teamDescription: z.string().nullable(),
    needs: z.array(z.object({ catalogId: z.string(), statement: z.string(), weight: z.number().int() })),
    formHref: z.string(),
    saved: z.literal(false),
  })
  .strict();

export function needFormHref(d: Omit<NeedDraft, 'formHref'>): string {
  const p = new URLSearchParams();
  p.set('title', d.title);
  p.set('spec', d.specialization);
  p.set('grade', d.grade);
  if (d.stack.length) p.set('stack', d.stack.join(','));
  if (d.salaryFrom) p.set('from', String(d.salaryFrom));
  if (d.salaryTo) p.set('to', String(d.salaryTo));
  if (d.teamDescription) p.set('team', d.teamDescription);
  if (d.needs.length) p.set('needs', d.needs.map((n) => n.catalogId).join(','));
  return `/employer/needs/new?${p.toString()}`;
}

/**
 * Черновик потребности из описания словами (R-E-02): специализация, грейд, стек, вилка;
 * требования — сигнатура категории из каталога (как поиск по базе). Не сохраняет:
 * ссылка ведёт в форму с предзаполнением, сохраняет человек.
 */
export const createNeedDraft: EmployerTool = {
  name: 'create_need_draft',
  description:
    'Предзаполнить потребность из описания словами: название, специализация, грейд, стек, вилка, требования из каталога. Ничего не сохраняет — в ленте появляется черновик со ссылкой на форму, сохраняет работодатель. Поля, которые ты понял из разговора, передай явно; остальное инструмент попробует распознать в описании.',
  input: Input,
  output: Output,
  async handler(ctx, input: z.infer<typeof Input>) {
    const spec = input.specialization ?? parseSpecialization(input.description);
    if (!spec) throw errors.badRequest('Не понял специализацию - уточни у работодателя: Backend или Frontend');
    const grade = input.grade ?? parseGrade(input.description) ?? 'junior';
    const stack = normalizeStack(input.stack?.length ? input.stack : parseStack(input.description)).slice(0, 15);
    const sal = parseSalary(input.description);
    const salaryFrom = input.salaryFrom ?? sal.from;
    const salaryTo = input.salaryTo ?? sal.to ?? salaryFrom;
    const catalog = await loadCatalog();
    const needs = categoryNeeds(catalog, spec, grade)
      .sort((a, b) => b.weight - a.weight || a.catalogId.localeCompare(b.catalogId))
      .slice(0, NEED_DRAFT_PICK)
      .map((n) => ({ catalogId: n.catalogId, statement: catalog.get(n.catalogId)?.statement ?? n.catalogId, weight: Math.min(3, Math.max(1, Math.round(n.weight))) }));
    const title = input.title ?? `${SPEC_ROLE[spec]} ${grade === 'middle' ? 'Middle' : 'Junior'}${stack.length ? ` (${stack.slice(0, 3).join(', ')})` : ''}`;
    const base = { title, specialization: spec, grade, stack, salaryFrom, salaryTo, teamDescription: input.description.slice(0, 2000), needs };
    const draft: NeedDraft = { ...base, formHref: needFormHref(base) };
    ctx.emit({ type: 'need_draft', draft });
    return { ...draft, saved: false as const };
  },
};
