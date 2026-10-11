import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACTIVITY } from '../../../prisma/seed/content/activity';
import { ALL_COMPANIES, ALL_VACANCIES, EXISTING_PROJECTS } from '../../../prisma/seed/content/index';
import { COMPANY_SLUGS, companyId, employerUserId, type ProjectContent } from '../../../prisma/seed/content/types';
import { DEMO_POOL } from '../../../prisma/seed/employer';
import { DEMO_POOL_EXTRA } from '../../../prisma/seed/employer-pool';
import { DEMO_VACANCIES } from '../../../prisma/seed/recommend';
import { EMPLOYER_PERSONAS } from '../../../src/server/demo/personas';
import { getSubcategory, SUBCATEGORIES, subcategoryMatches } from '../../../src/lib/directions';
import { assembleSpec, requiredCriteria, splitWishes, wishCriteria, type SpecContext } from '../../../src/server/project/fallback';
import { MAX_REQUIRED_CRITERIA, MAX_WISH_CRITERIA, RubricJson, SpecJson, SpecLlmOut } from '../../../src/server/project/schemas';
import { getTemplate, readContract } from '../../../src/server/project/templates';

/**
 * Контент работодательской стороны (prisma/seed/content/) проверяется без БД: иначе ошибка автора всплывёт
 * только при сиде на стенде. Границы — из server/employer/schemas.ts (вакансия) и server/project/schemas.ts (условие).
 */

const catalog = new Map(
  (JSON.parse(readFileSync(path.resolve(__dirname, '../../../prisma/seed/claims-catalog.json'), 'utf8')) as { entries: { id: string; specialization: string; statement: string }[] }).entries.map((e) => [e.id, e]),
);
const SALARY: Record<string, [number, number]> = { junior: [60_000, 170_000], middle: [150_000, 360_000], senior: [250_000, 700_000] };
const byId = new Map(ALL_VACANCIES.map((v) => [v.id, v]));
const oldById = new Map(DEMO_VACANCIES.map((v) => [v.id, v]));

function checkProject(where: string, p: ProjectContent, v: { specialization: string; grade: string; subcategoryId: string | undefined; title: string; description: string; teamDescription: string; stack: string[] }, companyName: string, salaries: number[]) {
  const t = getTemplate(p.templateId);
  expect(t, `${where}: шаблон ${p.templateId} не найден`).not.toBeNull();
  const m = t!.manifest;
  expect(m.specialization, `${where}: направление шаблона`).toBe(v.specialization);
  expect(m.grade, `${where}: грейд шаблона`).toBe(v.grade);
  if (v.subcategoryId) expect(m.subcategoryId, `${where}: подкатегория шаблона`).toBe(v.subcategoryId);

  expect(p.requiredCatalogIds.length, `${where}: requiredCatalogIds`).toBeGreaterThanOrEqual(1);
  expect(p.requiredCatalogIds.length).toBeLessThanOrEqual(MAX_REQUIRED_CRITERIA);
  expect(new Set(p.requiredCatalogIds).size).toBe(p.requiredCatalogIds.length);
  for (const id of p.requiredCatalogIds) {
    const e = catalog.get(id);
    expect(e, `${where}: критерий ${id} не из каталога`).toBeDefined();
    expect(['common', v.specialization], `${where}: критерий ${id} чужого направления`).toContain(e!.specialization);
  }
  expect(p.deadlineDays).toBeGreaterThanOrEqual(1);
  expect(p.deadlineDays).toBeLessThanOrEqual(30);

  const wishes = splitWishes(p.wishesText ?? '');
  expect(wishes.length, `${where}: пожеланий больше ${MAX_WISH_CRITERIA}`).toBeLessThanOrEqual(MAX_WISH_CRITERIA);
  if (p.wishesText) expect(wishes.length, `${where}: пожелания не распознаны splitWishes`).toBeGreaterThan(0);

  const required = p.requiredCatalogIds.map((id) => ({ catalogId: id, statement: catalog.get(id)!.statement }));
  const contractMd = readContract(t!);
  const ctx: SpecContext = {
    mode: 'spec',
    template: { id: m.id, title: m.title, summary: m.summary, grade: m.grade, subcategoryId: m.subcategoryId, stack: m.stack, contractMd: contractMd.slice(0, 8000), timeBudgetMin: m.timeBudgetMin },
    need: { title: v.title, teamDescription: v.teamDescription, description: v.description, stack: v.stack },
    required,
    wishes: p.wishesText,
  };
  const out = SpecLlmOut.parse({ domainStory: p.domainStory, requirements: p.requirements });
  const spec = assembleSpec(ctx, out, contractMd, 'fallback');
  expect(() => SpecJson.parse(spec), `${where}: условие не проходит SpecJson`).not.toThrow();
  expect(spec.requirements.length, `${where}: все требования выброшены как пересказ контракта`).toBeGreaterThan(1);
  expect(() => RubricJson.parse({ criteria: [...requiredCriteria(required), ...wishCriteria(wishes)] })).not.toThrow();

  // Антиутечка: кандидат видит задание без названия компании и зарплаты (platform.md, «Три ступени»).
  const legend = [p.domainStory, ...p.requirements, p.wishesText ?? ''].join('\n').toLowerCase();
  for (const token of companyName.toLowerCase().split(/\s+/).filter((w) => w.length > 3)) expect(legend, `${where}: в легенде название компании «${token}»`).not.toContain(token);
  for (const s of salaries) expect(legend, `${where}: в легенде зарплата ${s}`).not.toMatch(new RegExp(String(Math.round(s / 1000))));
}

describe('seed/content: компании', () => {
  it('десять компаний с замороженными slug, уникальными именами и логинами', () => {
    expect(ALL_COMPANIES.map((c) => c.slug).sort()).toEqual([...COMPANY_SLUGS].sort());
    expect(new Set(ALL_COMPANIES.map((c) => c.name)).size).toBe(ALL_COMPANIES.length);
    const emails = ALL_COMPANIES.flatMap((c) => (c.employer ? [c.employer.email] : []));
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails.length, 'логин у каждой новой компании').toBe(7);
    for (const c of ALL_COMPANIES) {
      const first = c.description.split('\n').find((l) => l.trim())!;
      expect(first.length, `${c.slug}: слоган`).toBeLessThan(140);
      expect(c.description.split(/\n\s*\n/).length, `${c.slug}: нужен второй абзац`).toBeGreaterThanOrEqual(2);
      expect(c.contact).toMatch(/@/);
      expect(c.industry.length).toBeGreaterThan(2);
    }
  });

  it('у каждой компании с логином есть персона на экране входа жюри', () => {
    const ids = new Set(EMPLOYER_PERSONAS.map((p) => p.id));
    for (const c of ALL_COMPANIES) if (c.employer) expect(ids.has(employerUserId(c.slug)), `${c.slug}: нет в EMPLOYER_PERSONAS`).toBe(true);
    expect(new Set(EMPLOYER_PERSONAS.map((p) => p.id)).size).toBe(EMPLOYER_PERSONAS.length);
  });

  it('у каждой компании есть вакансии (у новых — не меньше двух)', () => {
    for (const c of ALL_COMPANIES) {
      const own = ALL_VACANCIES.filter((v) => v.companySlug === c.slug).length + DEMO_VACANCIES.filter((v) => v.companyId === companyId(c.slug)).length;
      expect(own, `${c.slug}`).toBeGreaterThanOrEqual(c.employer ? 2 : 1);
    }
  });
});

describe('seed/content: вакансии', () => {
  it('id уникальны, формата demo-vac-<slug>-<n>, и не у «Северного Потока» (его список фиксирует employer-api.test)', () => {
    expect(new Set(ALL_VACANCIES.map((v) => v.id)).size).toBe(ALL_VACANCIES.length);
    for (const v of ALL_VACANCIES) {
      expect(v.id).toMatch(new RegExp(`^demo-vac-${v.companySlug}-\\d+$`));
      expect(oldById.has(v.id), `${v.id} совпадает со старой вакансией`).toBe(false);
      expect(v.companySlug).not.toBe('northstream');
    }
  });

  it('объём: не меньше 20 новых вакансий', () => {
    expect(ALL_VACANCIES.length).toBeGreaterThanOrEqual(20);
  });

  it.each(ALL_VACANCIES.map((v) => [v.id, v] as const))('%s: поля в границах формы работодателя и условие собирается', (_id, v) => {
    const company = ALL_COMPANIES.find((c) => c.slug === v.companySlug)!;
    expect(company).toBeDefined();
    expect(v.title.length).toBeGreaterThanOrEqual(3);
    expect(v.title.length).toBeLessThanOrEqual(120);
    expect(subcategoryMatches(v.specialization, v.subcategoryId), `${v.id}: подкатегория ${v.subcategoryId}`).toBe(true);
    expect(getSubcategory(v.subcategoryId)).toBeDefined();
    const [lo, hi] = SALARY[v.grade]!;
    expect(v.salaryFrom).toBeGreaterThanOrEqual(lo);
    expect(v.salaryTo).toBeLessThanOrEqual(hi);
    expect(v.salaryFrom).toBeLessThan(v.salaryTo);
    expect(v.stack.length).toBeGreaterThanOrEqual(3);
    expect(v.stack.length).toBeLessThanOrEqual(15);
    for (const s of v.stack) expect(s.length).toBeLessThanOrEqual(40);
    expect(v.needs.length).toBeGreaterThanOrEqual(1);
    expect(v.needs.length).toBeLessThanOrEqual(25);
    expect(new Set(v.needs.map(([id]) => id)).size).toBe(v.needs.length);
    for (const [id, w] of v.needs) {
      const e = catalog.get(id);
      expect(e, `${v.id}: need ${id} не из каталога`).toBeDefined();
      expect(['common', v.specialization]).toContain(e!.specialization);
      expect([1, 2, 3]).toContain(w);
    }
    expect(v.description.length).toBeGreaterThanOrEqual(200);
    expect(v.description.length).toBeLessThanOrEqual(2000);
    expect(v.teamDescription.length).toBeGreaterThanOrEqual(100);
    expect(v.teamDescription.length).toBeLessThanOrEqual(2000);
    checkProject(v.id, v.project, v, company.name, [v.salaryFrom, v.salaryTo]);
  });

  it('покрытие: все 18 подкатегорий и все три грейда у каждого направления (вместе со старыми вакансиями)', () => {
    const subs = new Set([...ALL_VACANCIES.map((v) => v.subcategoryId), 'backend.web-api', 'backend.integrations', 'frontend.ui-app']);
    for (const s of SUBCATEGORIES) expect(subs.has(s.id), `нет вакансии в ${s.id}`).toBe(true);
    for (const spec of ['backend', 'frontend', 'ai', 'engineering']) {
      const grades = new Set([...ALL_VACANCIES.filter((v) => v.specialization === spec).map((v) => v.grade), ...DEMO_VACANCIES.filter((v) => v.specialization === spec).map((v) => v.grade)]);
      expect([...grades].sort(), spec).toEqual(['junior', 'middle', 'senior']);
    }
  });
});

describe('seed/content: задания к старым вакансиям', () => {
  it('ключи — ровно 8 вакансий seed/recommend.ts', () => {
    expect(Object.keys(EXISTING_PROJECTS).sort()).toEqual(DEMO_VACANCIES.map((v) => v.id).sort());
  });

  it.each(Object.entries(EXISTING_PROJECTS))('%s: шаблон совпадает с вакансией, условие собирается', (vacancyId, p) => {
    const v = oldById.get(vacancyId)!;
    // Подкатегория старых вакансий ставится бэкфиллом seed/directions.ts: integrations у be-m-1, иначе web-api / ui-app.
    const sub = vacancyId === 'demo-vac-be-m-1' ? 'backend.integrations' : v.specialization === 'backend' ? 'backend.web-api' : 'frontend.ui-app';
    const company = ALL_COMPANIES.find((c) => companyId(c.slug) === v.companyId)!;
    checkProject(vacancyId, p, { ...v, subcategoryId: sub }, company.name, [v.salaryFrom, v.salaryTo]);
  });
});

describe('seed/content: активность', () => {
  const candidates = new Set([...DEMO_POOL, ...DEMO_POOL_EXTRA].map((p) => p.id));
  it('ссылается на существующие вакансии и кандидатов пула, не трогает персон пути', () => {
    expect(new Set(ACTIVITY.map((a) => a.id)).size).toBe(ACTIVITY.length);
    const pairs = new Set<string>();
    for (const a of ACTIVITY) {
      const v = byId.get(a.vacancyId) ?? oldById.get(a.vacancyId);
      expect(v, `${a.id}: вакансия ${a.vacancyId}`).toBeDefined();
      expect(['demo-invited', 'demo-accepted', 'demo-hired', 'demo-tested', 'demo-strong']).not.toContain(a.candidateId);
      expect(a.candidateId.startsWith('demo-'), a.id).toBe(true);
      if (a.kind === 'application') {
        const key = `${a.vacancyId}:${a.candidateId}`;
        expect(pairs.has(key), `${a.id}: повтор отклика`).toBe(false);
        pairs.add(key);
      } else {
        expect(a.salaryFrom).toBeLessThan(a.salaryTo);
      }
      expect(a.message.length).toBeGreaterThan(20);
    }
    expect(candidates.size).toBeGreaterThan(0);
  });
});
