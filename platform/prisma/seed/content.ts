import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Grade as PrismaGrade, Prisma, PrismaClient } from '@prisma/client';

import { CONSENT_TEXTS } from '../../src/server/consent/texts';
import { assembleSpec, fillRequirementsFromRubric, requiredCriteria, splitWishes, wishCriteria, type SpecContext } from '../../src/server/project/fallback';
import { SpecLlmOut } from '../../src/server/project/schemas';
import { getTemplate, getTemplates, readContract, type LoadedTemplate } from '../../src/server/project/templates';

import { ACTIVITY } from './content/activity';
import { ALL_COMPANIES, ALL_VACANCIES, EXISTING_PROJECTS } from './content/index';
import { companyId, employerProfileId, employerUserId, type ProjectContent } from './content/types';

/**
 * Сид контента работодательской стороны (prisma/seed/content/): 10 компаний, вакансии всех четырёх направлений,
 * проектное задание у каждой вакансии (включая 8 из seed/recommend.ts), демо-логин представителя на новую компанию,
 * отклики и приглашения. Условие задания собирается детерминированно из ручной легенды (assembleSpec, source
 * 'fallback'): модель не вызывается, сид на стенде не зависит от сети. Идемпотентен: фиксированные id, upsert;
 * задание с сдачами не перезаписывается (правило upsertProjectTask). Вызывать после seedDemoPersonas.
 * Все компании, люди и адреса вымышлены.
 */

// Корень шаблонов не зависит от cwd: сид могут запустить не из platform/.
process.env.PROJECT_TEMPLATES_DIR ??= path.resolve(__dirname, '../../project-templates');

type CatalogEntry = { id: string; specialization: string; statement: string };

function loadCatalog(): Map<string, CatalogEntry> {
  const raw = JSON.parse(readFileSync(path.resolve(__dirname, 'claims-catalog.json'), 'utf8')) as { entries: CatalogEntry[] };
  return new Map(raw.entries.map((e) => [e.id, e]));
}

/** Та же проекция манифеста в ProjectTemplate, что в project/service.ts syncTemplates (его нельзя импортировать: prisma-синглтон). */
function templateRow(t: LoadedTemplate) {
  const m = t.manifest;
  return {
    subcategoryId: m.subcategoryId,
    specialization: m.specialization,
    grade: m.grade as PrismaGrade,
    title: m.title,
    contractMd: readContract(t),
    dirRef: t.dirRef,
    hiddenTestsRef: `${t.dirRef}/${m.hiddenTestsRef}`,
    visibleTestsRef: `${t.dirRef}/${m.visibleTestsRef}`,
    stackTags: m.stack,
    image: m.image,
    timeBudgetMin: m.timeBudgetMin,
  };
}

async function syncTemplates(prisma: PrismaClient): Promise<number> {
  let n = 0;
  for (const t of getTemplates()) {
    const data = templateRow(t);
    await prisma.projectTemplate.upsert({ where: { id: t.manifest.id }, update: data, create: { id: t.manifest.id, ...data } });
    n++;
  }
  return n;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function seedEmployerLogin(prisma: PrismaClient, slug: (typeof ALL_COMPANIES)[number]['slug'], e: { name: string; email: string }): Promise<void> {
  const userId = employerUserId(slug);
  await prisma.user.upsert({
    where: { id: userId },
    update: { name: e.name, role: 'employer', isDemo: true },
    create: { id: userId, name: e.name, email: e.email, role: 'employer', isDemo: true, onboardedAt: new Date() },
  });
  await prisma.employerProfile.upsert({
    where: { userId },
    update: { companyId: companyId(slug) },
    create: { id: employerProfileId(slug), userId, companyId: companyId(slug) },
  });
  for (const kind of ['pd_processing', 'employer_offer', 'employer_data_obligation'] as const) {
    const version = CONSENT_TEXTS[kind].version;
    const has = await prisma.consent.count({ where: { userId, kind, version, revokedAt: null } });
    if (!has) await prisma.consent.create({ data: { userId, kind, version } });
  }
}

type VacancyRow = { id: string; title: string; description: string | null; teamDescription: string | null; stack: string[] };

/** Задание к вакансии: легенда автора поверх контракта шаблона. Пропускается, если по заданию уже есть сдачи. */
async function upsertProject(prisma: PrismaClient, v: VacancyRow, p: ProjectContent, catalog: Map<string, CatalogEntry>): Promise<'written' | 'kept'> {
  const t = getTemplate(p.templateId);
  if (!t) throw new Error(`seed(content): шаблон ${p.templateId} не найден (вакансия ${v.id})`);
  const existing = await prisma.projectTask.findUnique({ where: { vacancyId: v.id }, include: { _count: { select: { submissions: true } } } });
  if (existing && existing._count.submissions > 0) return 'kept';

  const m = t.manifest;
  const required = p.requiredCatalogIds.map((id) => {
    const e = catalog.get(id);
    if (!e) throw new Error(`seed(content): критерий ${id} не из каталога (вакансия ${v.id})`);
    return { catalogId: id, statement: e.statement };
  });
  const contractMd = readContract(t);
  const ctx: SpecContext = {
    mode: 'spec',
    template: { id: m.id, title: m.title, summary: m.summary, grade: m.grade, subcategoryId: m.subcategoryId, stack: m.stack, contractMd: contractMd.slice(0, 8000), timeBudgetMin: m.timeBudgetMin },
    need: { title: v.title, teamDescription: v.teamDescription, description: v.description, stack: v.stack },
    required,
    wishes: p.wishesText,
  };
  const rubric = { criteria: [...requiredCriteria(required), ...wishCriteria(splitWishes(p.wishesText ?? ''))] };
  // Как в upsertProjectTask: если фильтр пересказа контракта выбросил все требования, показываем критерии рубрики.
  const spec = fillRequirementsFromRubric(assembleSpec(ctx, SpecLlmOut.parse({ domainStory: p.domainStory, requirements: p.requirements }), contractMd, 'fallback'), rubric.criteria);
  const data = {
    templateId: m.id,
    specialization: m.specialization,
    grade: m.grade as PrismaGrade,
    subcategoryId: m.subcategoryId,
    visibility: p.visibility ?? 'open',
    specJson: spec as unknown as Prisma.InputJsonValue,
    requiredCatalogIds: p.requiredCatalogIds,
    wishesText: p.wishesText,
    rubricJson: rubric as unknown as Prisma.InputJsonValue,
    deadlineDays: p.deadlineDays,
  };
  await prisma.projectTask.upsert({ where: { vacancyId: v.id }, update: data, create: { id: `demo-pt-${v.id}`, vacancyId: v.id, ...data } });
  return 'written';
}

export async function seedContent(prisma: PrismaClient): Promise<void> {
  const catalog = loadCatalog();
  const templates = await syncTemplates(prisma);

  let logins = 0;
  for (const c of ALL_COMPANIES) {
    const id = companyId(c.slug);
    const data = { name: c.name, description: c.description, industry: c.industry, contact: c.contact, isDemo: true };
    await prisma.company.upsert({ where: { id }, update: data, create: { id, ...data } });
    if (c.employer) {
      await seedEmployerLogin(prisma, c.slug, c.employer);
      logins++;
    }
  }

  for (const v of ALL_VACANCIES) {
    const data = {
      companyId: companyId(v.companySlug),
      title: v.title,
      specialization: v.specialization,
      grade: v.grade as PrismaGrade,
      subcategoryId: v.subcategoryId,
      salaryFrom: v.salaryFrom,
      salaryTo: v.salaryTo,
      stack: v.stack,
      needs: v.needs.map(([catalogId, weight]) => ({ catalogId, weight })) as unknown as Prisma.InputJsonValue,
      description: v.description,
      teamDescription: v.teamDescription,
    };
    await prisma.vacancy.upsert({ where: { id: v.id }, update: data, create: { id: v.id, ...data } });
  }

  let written = 0;
  let kept = 0;
  const projects: [VacancyRow, ProjectContent][] = ALL_VACANCIES.map((v) => [v, v.project]);
  for (const [vacancyId, p] of Object.entries(EXISTING_PROJECTS)) {
    const row = await prisma.vacancy.findUnique({ where: { id: vacancyId }, select: { id: true, title: true, description: true, teamDescription: true, stack: true } });
    if (!row) throw new Error(`seed(content): вакансия ${vacancyId} из existing-projects не найдена — порядок сидов?`);
    projects.push([row, p]);
  }
  for (const [v, p] of projects) {
    const r = await upsertProject(prisma, v, p, catalog);
    if (r === 'written') written++;
    else kept++;
  }

  let applications = 0;
  let invitations = 0;
  for (const a of ACTIVITY) {
    const created = daysAgo(a.ageDays);
    const viewedAt = a.status !== 'sent' ? new Date(created.getTime() + 3_600_000) : null;
    const respondedAt = a.status === 'accepted' || a.status === 'declined' ? new Date(created.getTime() + 7_200_000) : null;
    if (a.kind === 'application') {
      const data = { vacancyId: a.vacancyId, candidateId: a.candidateId, status: a.status, message: a.message, createdAt: created, viewedAt, respondedAt };
      await prisma.application.upsert({ where: { id: a.id }, update: data, create: { id: a.id, ...data } });
      applications++;
    } else {
      const vacancy = await prisma.vacancy.findUnique({ where: { id: a.vacancyId }, select: { companyId: true, company: { select: { employers: { select: { id: true }, take: 1 } } } } });
      if (!vacancy) throw new Error(`seed(content): вакансия ${a.vacancyId} для приглашения ${a.id} не найдена`);
      const data = {
        vacancyId: a.vacancyId, candidateId: a.candidateId, companyId: vacancy.companyId, employerProfileId: vacancy.company.employers[0]?.id ?? null,
        status: a.status, salaryFrom: a.salaryFrom, salaryTo: a.salaryTo, message: a.message, createdAt: created, viewedAt, respondedAt,
      };
      await prisma.invitation.upsert({ where: { id: a.id }, update: data, create: { id: a.id, ...data } });
      invitations++;
    }
  }

  console.log(
    `seed(content): ${templates} project templates, ${ALL_COMPANIES.length} companies (${logins} new logins), ${ALL_VACANCIES.length} vacancies, ` +
      `${written} project tasks written, ${kept} kept (have submissions), ${applications} applications, ${invitations} invitations`,
  );
}
