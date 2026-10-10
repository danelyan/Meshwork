// Ступень 2 «проект под работодателя» (ADR 0003 + «Дополнение 10.10»): задание к потребности, лента
// обезличенных заданий, «взять» с лимитом, сабмит репозитория → runner → рубрика → отчёт работодателю,
// «пригласить на защиту». Работодатель видит сабмиты под псевдонимом (R-C-16) до принятого приглашения.
import { createHash } from 'node:crypto';

import type { Grade as PrismaGrade, Prisma, ProjectSubmissionStatus } from '@prisma/client';

import { githubHeaders } from '../collector/github';
import { getText } from '../collector/http-json';
import { maskContacts } from '../collector/mask';
import { prisma } from '../db';
import { categoryLabel } from '../employer/ranking';
import { createInvitation } from '../employer/invitations';
import { pseudonym } from '../employer/privacy';
import { AppError, errors } from '../errors';
import { loadCatalog } from '../recommend/evidence';
import { downloadGithubTarball, parseGithubRepoUrl, type GithubRepo } from '../runner/client';
import type { Grade as CategoryGrade, Specialization } from '../types';

/** Грейд в модуле project: junior | middle | senior (Senior — ADR 0003 «Дополнение 16:15»). */
type Grade = PrismaGrade;

import { readTarGz, writeZip } from './archive';
import { getDefenseHook } from './defense-hook';
import { fillRequirementsFromRubric, type SpecContext } from './fallback';
import { reviewRubric } from './review';
import { getProjectRunner, type RunOutcome } from './runner-client';
import {
  DEFAULT_DEADLINE_DAYS,
  MAX_SUBMISSIONS_PER_TASK,
  PROJECT_MAX_ACTIVE,
  RubricJson,
  type InviteToDefenseInput,
  type ProjectTaskInput,
  type ResultJson,
  type StoredSpec,
  type SubmissionInput,
} from './schemas';
import { composeRubric, generateSpec, maskEmployer } from './spec';
import {
  checkPlatformOwned,
  countTests,
  getTemplate,
  getTemplates,
  ownedFileHashes,
  readContract,
  readStarter,
  readVisibleTests,
  type LoadedTemplate,
  type TemplateFile,
} from './templates';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Названия подкатегорий до слияния лейна directions (модель Subcategory); там — из БД. */
export const SUBCATEGORY_TITLES: Record<string, string> = {
  'backend.web-api': 'Веб-API',
  'backend.integrations': 'Интеграции',
  'frontend.ui-app': 'UI-приложение',
  'ai.llm-apps': 'LLM-приложения',
  'engineering.data-eng': 'Инженерия данных',
};

const SPEC_RU: Record<string, string> = { backend: 'Backend', frontend: 'Frontend', ai: 'AI', engineering: 'Engineering' };

// --- шаблоны ---

let synced = false;

/** Снимок шаблонов с диска в ProjectTemplate (для связей). Раз на процесс. */
export async function syncTemplates(force = false): Promise<void> {
  if (synced && !force) return;
  for (const t of getTemplates()) {
    const m = t.manifest;
    const data = {
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
    try {
      await prisma.projectTemplate.upsert({ where: { id: m.id }, update: data, create: { id: m.id, ...data } });
    } catch (err) {
      // Один шаблон не должен ронять ленту: например, грейд senior до миграции enum Grade (lane directions).
      console.warn(`[project] шаблон ${m.id} не записан в ProjectTemplate`, err instanceof Error ? err.message.split('\n').pop() : err);
    }
  }
  synced = true;
}

export interface TemplateView {
  id: string;
  title: string;
  summary: string;
  specialization: string;
  subcategoryId: string;
  subcategoryTitle: string;
  grade: Grade;
  stack: string[];
  timeBudgetMin: number;
  catalogIds: string[];
  tests: { visible: number; hidden: number };
}

export function templateView(t: LoadedTemplate): TemplateView {
  const m = t.manifest;
  return {
    id: m.id,
    title: m.title,
    summary: m.summary,
    specialization: m.specialization,
    subcategoryId: m.subcategoryId,
    subcategoryTitle: SUBCATEGORY_TITLES[m.subcategoryId] ?? m.subcategoryId,
    grade: m.grade,
    stack: m.stack,
    timeBudgetMin: m.timeBudgetMin,
    catalogIds: m.catalogIds,
    tests: { visible: countTests(t, 'visible'), hidden: countTests(t, 'hidden') },
  };
}

export function listTemplateViews(filter: { specialization?: string; grade?: string } = {}): TemplateView[] {
  return getTemplates()
    .filter((t) => (!filter.specialization || t.manifest.specialization === filter.specialization) && (!filter.grade || t.manifest.grade === filter.grade))
    .map(templateView);
}

function pickTemplate(spec: string, grade: string, subcategoryId?: string): LoadedTemplate | null {
  const all = getTemplates().filter((t) => t.manifest.specialization === spec);
  return (
    all.find((t) => t.manifest.grade === grade && (!subcategoryId || t.manifest.subcategoryId === subcategoryId)) ??
    all.find((t) => t.manifest.grade === grade) ??
    null
  );
}

function requireTemplate(id: string): LoadedTemplate {
  const t = getTemplate(id);
  if (!t) throw new AppError('template_missing', `Шаблон ${id} не найден на диске`, 500);
  return t;
}

// --- задание к потребности (работодатель) ---

type TaskRow = Prisma.ProjectTaskGetPayload<{ include: { _count: { select: { assignments: true; submissions: true } } } }>;

export interface EmployerTaskView {
  id: string;
  vacancyId: string;
  template: TemplateView;
  visibility: 'open' | 'invited';
  spec: StoredSpec;
  rubric: RubricJson;
  requiredCatalogIds: string[];
  wishesText: string | null;
  deadlineDays: number | null;
  createdAt: string;
  updatedAt: string;
  stats: { taken: number; submissions: number };
}

function employerTaskView(t: TaskRow): EmployerTaskView {
  return {
    id: t.id,
    vacancyId: t.vacancyId,
    template: templateView(requireTemplate(t.templateId)),
    visibility: t.visibility,
    spec: t.specJson as unknown as StoredSpec,
    rubric: t.rubricJson as unknown as RubricJson,
    requiredCatalogIds: t.requiredCatalogIds,
    wishesText: t.wishesText,
    deadlineDays: t.deadlineDays,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    stats: { taken: t._count.assignments, submissions: t._count.submissions },
  };
}

const COUNT = { _count: { select: { assignments: true, submissions: true } } } as const;

export async function getEmployerTask(companyId: string, vacancyId: string): Promise<EmployerTaskView | null> {
  const v = await prisma.vacancy.findFirst({ where: { id: vacancyId, companyId }, select: { id: true } });
  if (!v) throw errors.notFound('Потребность не найдена');
  const task = await prisma.projectTask.findUnique({ where: { vacancyId }, include: COUNT });
  return task ? employerTaskView(task) : null;
}

/**
 * Создать или перегенерировать задание потребности. Перегенерация после первого сабмита запрещена (409):
 * условие поменялось бы у тех, кто уже сдал. Шаблон — указанный или первый под направление/грейд.
 */
export async function upsertProjectTask(
  ctx: { companyId: string; companyName: string },
  vacancyId: string,
  input: ProjectTaskInput,
): Promise<EmployerTaskView> {
  const vacancy = await prisma.vacancy.findFirst({ where: { id: vacancyId, companyId: ctx.companyId, archivedAt: null } });
  if (!vacancy) throw errors.notFound('Потребность не найдена');
  const existing = await prisma.projectTask.findUnique({ where: { vacancyId }, include: COUNT });
  if (existing && existing._count.submissions > 0) {
    throw errors.conflict('Задание уже сдают: перегенерация поменяла бы условие у тех, кто сдал. Создай новую потребность.');
  }
  const template = input.templateId ? getTemplate(input.templateId) : pickTemplate(vacancy.specialization, vacancy.grade, input.subcategoryId);
  if (!template) throw new AppError('bad_request', 'Нет шаблона проекта под это направление и грейд', 400);

  const catalog = await loadCatalog();
  const allowed = new Set([template.manifest.specialization, vacancy.specialization, 'common']);
  const requiredIds = [...new Set(input.requiredCatalogIds)];
  const bad = requiredIds.filter((id) => !catalog.has(id) || !allowed.has(catalog.get(id)!.specialization));
  if (bad.length) throw new AppError('bad_request', `Критерии не из каталога этого направления: ${bad.join(', ')}`, 400, { catalogIds: bad });
  const required = requiredIds.map((id) => ({ catalogId: id, statement: catalog.get(id)!.statement }));

  await syncTemplates();
  const m = template.manifest;
  const specCtx: SpecContext = {
    mode: 'spec',
    template: { id: m.id, title: m.title, summary: m.summary, grade: m.grade, subcategoryId: m.subcategoryId, stack: m.stack, contractMd: readContract(template).slice(0, 8000), timeBudgetMin: m.timeBudgetMin },
    need: { title: vacancy.title, teamDescription: vacancy.teamDescription, description: vacancy.description, stack: vacancy.stack },
    required,
    wishes: input.wishesText,
  };
  const [rawSpec, rubric] = await Promise.all([generateSpec(specCtx, [ctx.companyName], { contractMd: readContract(template) }), composeRubric(required, input.wishesText)]);
  // Фильтр пересказа контракта мог выбросить все требования модели — тогда показываем критерии рубрики.
  const spec = fillRequirementsFromRubric(rawSpec, maskEmployer(rubric.criteria, [ctx.companyName]));
  const data = {
    templateId: m.id,
    specialization: m.specialization,
    grade: m.grade as PrismaGrade,
    subcategoryId: m.subcategoryId,
    visibility: input.visibility,
    specJson: spec as unknown as Prisma.InputJsonValue,
    requiredCatalogIds: requiredIds,
    wishesText: input.wishesText,
    rubricJson: { criteria: rubric.criteria } as unknown as Prisma.InputJsonValue,
    deadlineDays: input.deadlineDays ?? null,
  };
  const task = await prisma.projectTask.upsert({ where: { vacancyId }, update: data, create: { vacancyId, ...data }, include: COUNT });
  return employerTaskView(task);
}

// --- кандидат: лента, взять, задание ---

interface CandidateScope {
  specialization: string | null;
  grade: Grade | null;
  /** Категория из теста (а не заявленное направление). */
  fromTest: boolean;
}

async function candidateScope(candidateId: string): Promise<CandidateScope> {
  const [cat, cand] = await Promise.all([
    prisma.candidateCategory.findFirst({ where: { candidateId }, orderBy: { confirmedAt: 'desc' }, select: { specialization: true, grade: true } }),
    prisma.candidate.findUnique({ where: { id: candidateId }, select: { specialization: true } }),
  ]);
  if (!cand) throw errors.notFound('Кандидат не найден');
  if (cat) return { specialization: cat.specialization, grade: cat.grade, fromTest: true };
  return { specialization: cand.specialization, grade: null, fromTest: false };
}

const GRADE_ORDER: Grade[] = ['junior', 'middle', 'senior'];

/** Грейды открытых заданий, доступные кандидату: не выше категории из теста; без категории — только Junior. */
function allowedGrades(scope: CandidateScope): Grade[] {
  if (!scope.grade) return ['junior'];
  return GRADE_ORDER.slice(0, GRADE_ORDER.indexOf(scope.grade) + 1);
}

type TaskWithTemplate = Prisma.ProjectTaskGetPayload<{ include: { vacancy: { select: { archivedAt: true } } } }>;

export interface FeedItem {
  id: string;
  title: string;
  domainStory: string;
  spec: StoredSpec;
  specialization: string;
  specializationLabel: string;
  subcategoryId: string | null;
  subcategoryTitle: string | null;
  grade: Grade;
  stack: string[];
  timeBudgetMin: number;
  deadlineDays: number;
  visibleTests: TemplateFile[];
  /** Задание пришло по приглашению работодателя (visibility invited). */
  invited: boolean;
  my: {
    taken: boolean;
    active: boolean;
    expiresAt: string | null;
    submissions: number;
    last: { id: string; status: ProjectSubmissionStatus; score: number | null } | null;
  };
  createdAt: string;
}

/** Карточка задания кандидату: без companyId, названия компании, потребности и зарплаты. */
function feedItem(
  t: TaskWithTemplate,
  invited: boolean,
  my: FeedItem['my'],
): FeedItem {
  const tpl = requireTemplate(t.templateId);
  const spec = t.specJson as unknown as StoredSpec;
  return {
    id: t.id,
    title: spec.title,
    domainStory: spec.domainStory,
    spec,
    specialization: t.specialization,
    specializationLabel: SPEC_RU[t.specialization] ?? t.specialization,
    subcategoryId: t.subcategoryId,
    subcategoryTitle: t.subcategoryId ? (SUBCATEGORY_TITLES[t.subcategoryId] ?? t.subcategoryId) : null,
    grade: t.grade,
    stack: tpl.manifest.stack,
    timeBudgetMin: tpl.manifest.timeBudgetMin,
    deadlineDays: t.deadlineDays ?? DEFAULT_DEADLINE_DAYS,
    visibleTests: readVisibleTests(tpl),
    invited,
    my,
    createdAt: t.createdAt.toISOString(),
  };
}

async function myState(candidateId: string, taskIds: string[], now = new Date()) {
  const [assignments, subs] = await Promise.all([
    prisma.projectAssignment.findMany({ where: { candidateId, projectTaskId: { in: taskIds } } }),
    prisma.projectSubmission.findMany({
      where: { candidateId, projectTaskId: { in: taskIds } },
      orderBy: { submittedAt: 'desc' },
      select: { id: true, projectTaskId: true, status: true, resultJson: true },
    }),
  ]);
  return (taskId: string): FeedItem['my'] => {
    const a = assignments.find((x) => x.projectTaskId === taskId);
    const mine = subs.filter((s) => s.projectTaskId === taskId);
    const last = mine[0];
    return {
      taken: !!a,
      active: !!a && a.status === 'active' && a.expiresAt > now,
      expiresAt: a ? a.expiresAt.toISOString() : null,
      submissions: mine.length,
      last: last ? { id: last.id, status: last.status, score: (last.resultJson as ResultJson | null)?.tests.score ?? null } : null,
    };
  };
}

/**
 * Лента (ADR 0003, п. 6): открытые задания направления кандидата (из теста, иначе заявленного), грейд —
 * по категории из теста; задания по приглашению — только приглашённым. Подкатегория кандидата — приоритет
 * в сортировке (поле Candidate.subcategoryId появится с лейном directions — интегратор передаст его сюда).
 */
export async function listFeed(candidateId: string, opts: { preferredSubcategoryId?: string | null } = {}): Promise<{ items: FeedItem[]; scope: CandidateScope; limit: { maxActive: number; active: number } }> {
  const scope = await candidateScope(candidateId);
  const invitedVacancies = (await prisma.invitation.findMany({ where: { candidateId, vacancyId: { not: null } }, select: { vacancyId: true } })).map((i) => i.vacancyId!);
  const tasks = await prisma.projectTask.findMany({
    where: {
      vacancy: { archivedAt: null },
      OR: [
        // Открытые — только своего направления и грейда не выше категории; без направления — ничего открытого.
        ...(scope.specialization ? [{ visibility: 'open' as const, specialization: scope.specialization, grade: { in: allowedGrades(scope) } }] : []),
        { vacancyId: { in: invitedVacancies } },
        { assignments: { some: { candidateId } } },
      ],
    },
    include: { vacancy: { select: { archivedAt: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const state = await myState(candidateId, tasks.map((t) => t.id));
  const pref = opts.preferredSubcategoryId ?? null;
  const items = tasks
    .filter((t) => getTemplate(t.templateId))
    .map((t) => feedItem(t, invitedVacancies.includes(t.vacancyId), state(t.id)))
    .sort((a, b) => Number(b.my.taken) - Number(a.my.taken) || Number(b.subcategoryId === pref && !!pref) - Number(a.subcategoryId === pref && !!pref));
  const active = await countActive(candidateId);
  return { items, scope, limit: { maxActive: PROJECT_MAX_ACTIVE, active } };
}

async function countActive(candidateId: string, now = new Date(), tx: Prisma.TransactionClient = prisma): Promise<number> {
  return tx.projectAssignment.count({ where: { candidateId, status: 'active', expiresAt: { gt: now } } });
}

/**
 * Задание доступно кандидату: уже взятое; по приглашению на эту потребность; открытое (потребность не в
 * архиве) своего направления и грейда не выше категории из теста (без категории — только Junior).
 */
async function loadAccessibleTask(candidateId: string, taskId: string): Promise<TaskWithTemplate> {
  const t = await prisma.projectTask.findUnique({ where: { id: taskId }, include: { vacancy: { select: { archivedAt: true } } } });
  if (!t || !getTemplate(t.templateId)) throw errors.notFound('Задание не найдено');
  const taken = await prisma.projectAssignment.findUnique({ where: { projectTaskId_candidateId: { projectTaskId: taskId, candidateId } }, select: { id: true } });
  if (taken) return t;
  if (t.vacancy.archivedAt) throw errors.notFound('Задание не найдено');
  if (t.visibility === 'invited') {
    const inv = await prisma.invitation.findFirst({ where: { candidateId, vacancyId: t.vacancyId }, select: { id: true } });
    if (!inv) throw errors.notFound('Задание не найдено');
    // Приглашение — решение работодателя: направление и грейд не проверяем.
    return t;
  }
  const scope = await candidateScope(candidateId);
  if (!scope.specialization) throw errors.forbidden('Сначала выбери направление — открытые задания подбираются по нему');
  if (t.specialization !== scope.specialization) throw errors.forbidden('Задание другого направления');
  if (!allowedGrades(scope).includes(t.grade)) {
    throw errors.forbidden(scope.grade ? 'Грейд задания выше твоей категории' : 'Пока нет категории из теста — доступны только задания Junior');
  }
  return t;
}

/** Взять задание: идемпотентно; лимит активных — PROJECT_MAX_ACTIVE (под advisory-lock кандидата). */
export async function takeTask(candidateId: string, taskId: string, now = new Date()): Promise<{ taskId: string; expiresAt: string; active: number; maxActive: number }> {
  const t = await loadAccessibleTask(candidateId, taskId);
  const days = t.deadlineDays ?? DEFAULT_DEADLINE_DAYS;
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-take:${candidateId}`}))`;
    const existing = await tx.projectAssignment.findUnique({ where: { projectTaskId_candidateId: { projectTaskId: taskId, candidateId } } });
    // Уже взято — срок не продлевается повторным «взять»: сдать после срока можно, но с пометкой late.
    if (existing) {
      return { taskId, expiresAt: existing.expiresAt.toISOString(), active: await countActive(candidateId, now, tx), maxActive: PROJECT_MAX_ACTIVE };
    }
    const active = await countActive(candidateId, now, tx);
    if (active >= PROJECT_MAX_ACTIVE) {
      throw new AppError('project_limit', `Одновременно можно держать не больше ${PROJECT_MAX_ACTIVE} несданных заданий — сдай одно из взятых`, 429, { maxActive: PROJECT_MAX_ACTIVE, active });
    }
    const expiresAt = new Date(now.getTime() + days * DAY_MS);
    await tx.projectAssignment.upsert({
      where: { projectTaskId_candidateId: { projectTaskId: taskId, candidateId } },
      update: { status: 'active', takenAt: now, expiresAt },
      create: { projectTaskId: taskId, candidateId, expiresAt },
    });
    return { taskId, expiresAt: expiresAt.toISOString(), active: active + 1, maxActive: PROJECT_MAX_ACTIVE };
  });
}

export interface CandidateTaskView extends FeedItem {
  contractMd: string;
  skeletonUrl: string;
  submissions: CandidateSubmissionView[];
}

export async function getTaskForCandidate(candidateId: string, taskId: string): Promise<CandidateTaskView> {
  const t = await loadAccessibleTask(candidateId, taskId);
  const invited = t.visibility === 'invited';
  const my = (await myState(candidateId, [t.id]))(t.id);
  const subs = await prisma.projectSubmission.findMany({ where: { candidateId, projectTaskId: taskId }, orderBy: { submittedAt: 'desc' } });
  return {
    ...feedItem(t, invited, my),
    // Контракт из условия (снимок на момент генерации); у старых заданий его нет — с диска.
    contractMd: (t.specJson as unknown as Partial<StoredSpec>).contractMd ?? readContract(requireTemplate(t.templateId)),
    skeletonUrl: `/api/project-tasks/${encodeURIComponent(t.id)}/skeleton.zip`,
    submissions: subs.map(candidateSubmissionView),
  };
}

/** TASK.md в заготовке: условие задания (то, что видит кандидат на странице). */
export function renderTaskMd(spec: StoredSpec): string {
  return [
    `# ${spec.title}`,
    '',
    spec.domainStory,
    '',
    '## Требования',
    ...spec.requirements.map((r) => `- ${r}`),
    '',
    '## Как проверяется',
    ...spec.acceptance.map((r) => `- ${r}`),
    '',
    spec.notes,
    '',
    '## Контракт (дословно, contract.md)',
    '',
    spec.contractMd ?? 'См. contract.md в корне заготовки.',
    '',
  ].join('\n');
}

export async function skeletonZip(candidateId: string, taskId: string): Promise<{ filename: string; data: Buffer }> {
  const t = await loadAccessibleTask(candidateId, taskId);
  const tpl = requireTemplate(t.templateId);
  const files = [...readStarter(tpl), { path: 'TASK.md', content: renderTaskMd(t.specJson as unknown as StoredSpec) }];
  return { filename: `${tpl.manifest.id}.zip`, data: writeZip(files, tpl.manifest.id) };
}

// --- сабмит и проверка ---

export interface CandidateSubmissionView {
  id: string;
  taskId: string;
  status: ProjectSubmissionStatus;
  repoUrl: string;
  commitSha: string | null;
  submittedAt: string;
  checkedAt: string | null;
  error: string | null;
  /** Кандидату — без имён скрытых тестов (они раскрывают набор). */
  result: Omit<ResultJson, 'hiddenTests'> | null;
}

function candidateSubmissionView(s: { id: string; projectTaskId: string; status: ProjectSubmissionStatus; repoUrl: string; commitSha: string | null; submittedAt: Date; checkedAt: Date | null; error: string | null; resultJson: Prisma.JsonValue | null }): CandidateSubmissionView {
  const r = s.resultJson as ResultJson | null;
  let result: CandidateSubmissionView['result'] = null;
  if (r) {
    const { hiddenTests: _hidden, ...rest } = r;
    void _hidden;
    result = rest;
  }
  return {
    id: s.id,
    taskId: s.projectTaskId,
    status: s.status,
    repoUrl: s.repoUrl,
    commitSha: s.commitSha,
    submittedAt: s.submittedAt.toISOString(),
    checkedAt: s.checkedAt?.toISOString() ?? null,
    error: s.error,
    result,
  };
}

/** HEAD ветки по умолчанию публичного репозитория (GitHub REST, `application/vnd.github.sha`). */
export async function resolveHeadSha(repo: GithubRepo): Promise<string> {
  const { text } = await getText(`https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/HEAD`, {
    headers: { ...githubHeaders(), accept: 'application/vnd.github.sha' },
    source: 'GitHub',
    notFound: 'Репозиторий не найден или приватный — нужен публичный репозиторий GitHub',
    maxBytes: 1024,
  });
  const sha = text.trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new AppError('fetch_failed', 'GitHub не вернул коммит', 502);
  return sha;
}

export interface SubmitDeps {
  /** false — не запускать проверку в фоне (тесты вызывают processSubmission сами). */
  background?: boolean;
}

/** Предыдущая сдача не на проверке и лимит сдач не исчерпан; возвращает число прошлых сдач. */
async function assertCanSubmit(tx: Prisma.TransactionClient, candidateId: string, taskId: string): Promise<number> {
  const prev = await tx.projectSubmission.findMany({ where: { candidateId, projectTaskId: taskId }, select: { status: true } });
  if (prev.some((p) => p.status === 'submitted' || p.status === 'running')) throw errors.conflict('Предыдущая сдача ещё проверяется');
  if (prev.length >= MAX_SUBMISSIONS_PER_TASK) throw new AppError('rate_limited', `Не больше ${MAX_SUBMISSIONS_PER_TASK} сдач одного задания`, 429);
  return prev.length;
}

export async function submitProject(candidateId: string, taskId: string, input: SubmissionInput, deps: SubmitDeps = {}): Promise<CandidateSubmissionView> {
  await loadAccessibleTask(candidateId, taskId);
  const assignment = await prisma.projectAssignment.findUnique({ where: { projectTaskId_candidateId: { projectTaskId: taskId, candidateId } } });
  if (!assignment) throw errors.conflict('Сначала возьми задание');
  const repo = parseGithubRepoUrl(input.repoUrl);
  if (!repo) throw new AppError('bad_request', 'Нужна ссылка на публичный репозиторий GitHub: https://github.com/<владелец>/<репозиторий>', 400);
  const repoUrl = `https://github.com/${repo.owner}/${repo.repo}`;
  const runner = getProjectRunner();
  // Ранний отказ без сети; окончательная проверка — ниже под блокировкой.
  await assertCanSubmit(prisma, candidateId, taskId);
  // Сеть — до транзакции, чтобы не держать блокировку на запросе к GitHub.
  const headSha = input.commitSha ?? (runner.mode === 'stub' ? null : await resolveHeadSha(repo));
  const sub = await prisma.$transaction(async (tx) => {
    // Две параллельные сдачи одного задания: вторая ждёт первую и получает 409 «ещё проверяется».
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-submit:${candidateId}:${taskId}`}))`;
    const prevCount = await assertCanSubmit(tx, candidateId, taskId);
    const commitSha = headSha ?? createHash('sha1').update(`${repoUrl}#${prevCount}`).digest('hex');
    // Срок истёк — сдать можно, но работодатель видит пометку «после срока».
    const late = assignment.expiresAt.getTime() < Date.now();
    const created = await tx.projectSubmission.create({ data: { projectTaskId: taskId, candidateId, repoUrl, commitSha, aiLogText: input.aiLogText, late } });
    await tx.projectAssignment.update({ where: { id: assignment.id }, data: { status: 'submitted' } });
    return created;
  });
  if (deps.background !== false) void processSubmission(sub.id);
  return candidateSubmissionView(sub);
}

const inFlight = new Set<string>();

const FAIL_REASON_RU: Record<string, string> = {
  timeout: 'Проверка не уложилась в лимит времени (зацикливание или слишком долгие тесты).',
  bad_archive: 'Архив репозитория не читается.',
  commit_mismatch: 'Коммит в архиве не совпал с указанным.',
  no_report: 'Тесты не запустились — проверь, что структура проекта совпадает с заготовкой.',
  bundle_not_found: 'Шаблон не найден в сервисе проверки.',
  internal: 'Сбой сервиса проверки, попробуй сдать ещё раз.',
};

async function fail(id: string, message: string): Promise<void> {
  await prisma.projectSubmission.update({ where: { id }, data: { status: 'failed', error: message, checkedAt: new Date() } });
}

/**
 * Проверка сабмита: (скачать tarball) → сверка файлов платформы → скрытые тесты (балл) → видимые тесты
 * (обратная связь кандидату) → LLM-рубрика (пояснения, не балл) → resultJson. Ошибка — status failed
 * с понятной причиной; детали скрытых тестов кандидату не уходят.
 */
export async function processSubmission(id: string): Promise<void> {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  try {
    const sub = await prisma.projectSubmission.findUnique({ where: { id }, include: { projectTask: true } });
    if (!sub || sub.status === 'checked' || sub.status === 'failed') return;
    const tpl = getTemplate(sub.projectTask.templateId);
    if (!tpl) return fail(id, 'Шаблон задания недоступен.');
    const resumeJob = sub.status === 'running' ? sub.runnerJobId : null;
    // Сабмиты lane project всегда с commitSha; null — запись не из этого модуля (схема допускает).
    const commitSha = sub.commitSha;
    if (!commitSha) return fail(id, 'Не указан коммит сдачи.');
    await prisma.projectSubmission.update({ where: { id }, data: { status: 'running' } });
    const runner = getProjectRunner();

    let files: Map<string, Uint8Array> | null = null;
    let tarball: Uint8Array | null = null;
    if (runner.mode === 'runner') {
      const repo = parseGithubRepoUrl(sub.repoUrl);
      if (!repo) return fail(id, 'Некорректная ссылка на репозиторий.');
      try {
        tarball = await downloadGithubTarball(repo, commitSha);
        files = readTarGz(tarball);
      } catch (err) {
        const msg = err instanceof AppError && err.status === 404 ? 'Репозиторий или коммит не найден — нужен публичный репозиторий GitHub.' : err instanceof AppError ? err.message : 'Не удалось скачать репозиторий.';
        return fail(id, msg);
      }
    }
    const violations = files ? checkPlatformOwned(ownedFileHashes(readStarter(tpl)), files) : [];

    const runInput = { template: tpl, tarball, repoUrl: sub.repoUrl, commitSha };
    let hidden: RunOutcome;
    try {
      hidden = resumeJob
        ? await runner.resume(resumeJob)
        : await runner.run({ ...runInput, suite: 'hidden', onJob: async (jobId) => void (await prisma.projectSubmission.update({ where: { id }, data: { runnerJobId: jobId } })) });
    } catch (err) {
      return fail(id, err instanceof AppError && err.status === 503 ? 'Сервис проверки недоступен, попробуй позже.' : 'Проверка не выполнилась.');
    }
    if (hidden.status === 'failed') return fail(id, FAIL_REASON_RU[hidden.reason ?? 'internal'] ?? FAIL_REASON_RU.internal!);

    let visible: RunOutcome | null = null;
    try {
      visible = await runner.run({ ...runInput, suite: 'visible' });
    } catch {
      visible = null;
    }

    const score = hidden.total ? Math.round((hidden.passed / hidden.total) * 100) : 0;
    const tests = { passed: hidden.passed, total: hidden.total, score };
    const rubricDef = RubricJson.safeParse(sub.projectTask.rubricJson);
    const review = await reviewRubric({ criteria: rubricDef.success ? rubricDef.data.criteria : [], files, tests, aiLog: sub.aiLogText ?? '' });
    const result: ResultJson = {
      tests,
      visibleTests: visible?.status === 'done' ? visible.tests : [],
      hiddenTests: hidden.tests,
      lint: hidden.lint
        ? { status: 'done', note: 'Статанализ runner', details: hidden.lint }
        : { status: 'skipped', note: 'Статанализ в этой версии runner не выполняется (контракт runner: поле lint отсутствует).' },
      rubric: review,
      platformOwnedViolations: violations,
      runner: { mode: runner.mode, durationMs: hidden.durationMs },
    };
    await prisma.projectSubmission.update({
      where: { id },
      data: { status: 'checked', resultJson: result as unknown as Prisma.InputJsonValue, checkedAt: new Date(), error: null },
    });
  } catch (err) {
    console.error('[project] processSubmission', id, err);
    await fail(id, 'Внутренняя ошибка проверки.').catch(() => undefined);
  } finally {
    inFlight.delete(id);
  }
}

/** Сабмит «застрял» (рестарт приложения посреди проверки) — продолжить в фоне. */
function resumeIfStale(s: { id: string; status: ProjectSubmissionStatus; submittedAt: Date }): void {
  if ((s.status === 'submitted' || s.status === 'running') && !inFlight.has(s.id) && Date.now() - s.submittedAt.getTime() > 60_000) {
    void processSubmission(s.id);
  }
}

export async function getSubmissionForCandidate(candidateId: string, id: string): Promise<CandidateSubmissionView> {
  const s = await prisma.projectSubmission.findFirst({ where: { id, candidateId } });
  if (!s) throw errors.notFound('Сдача не найдена');
  resumeIfStale(s);
  return candidateSubmissionView(s);
}

// --- работодатель: сабмиты и приглашение на защиту ---

export interface EmployerSubmissionView {
  id: string;
  status: ProjectSubmissionStatus;
  submittedAt: string;
  /** Сдано после срока задания. */
  late: boolean;
  checkedAt: string | null;
  error: string | null;
  candidate: { id: string; displayName: string; category: string | null };
  /** Ссылка на репозиторий раскрывает личность (логин GitHub) — только после принятого приглашения. */
  repoUrl: string | null;
  commitSha: string | null;
  aiLogText: string;
  result: ResultJson | null;
  defense: { invitationId: string; invitationStatus: string } | null;
}

export async function listEmployerSubmissions(companyId: string, vacancyId: string): Promise<{ task: EmployerTaskView | null; items: EmployerSubmissionView[] }> {
  const task = await getEmployerTask(companyId, vacancyId);
  if (!task) return { task: null, items: [] };
  const subs = await prisma.projectSubmission.findMany({
    where: { projectTaskId: task.id, candidate: { hiddenFromEmployers: false } },
    orderBy: { submittedAt: 'desc' },
    include: { candidate: { select: { id: true, name: true, categories: { orderBy: { confirmedAt: 'desc' }, take: 1, select: { specialization: true, grade: true } } } } },
  });
  const candidateIds = [...new Set(subs.map((s) => s.candidateId))];
  const invitations = await prisma.invitation.findMany({ where: { companyId, candidateId: { in: candidateIds } }, select: { id: true, candidateId: true, status: true } });
  const accepted = new Set(invitations.filter((i) => i.status === 'accepted').map((i) => i.candidateId));
  for (const s of subs) resumeIfStale(s);
  return {
    task,
    items: subs.map((s) => {
      const open = accepted.has(s.candidateId);
      const cat = s.candidate.categories[0];
      const inv = s.defenseInvitationId ? invitations.find((i) => i.id === s.defenseInvitationId) : undefined;
      return {
        id: s.id,
        status: s.status,
        submittedAt: s.submittedAt.toISOString(),
        late: s.late,
        checkedAt: s.checkedAt?.toISOString() ?? null,
        error: s.error,
        candidate: {
          id: s.candidateId,
          displayName: open ? s.candidate.name : pseudonym(s.candidateId),
          category: cat ? categoryLabel(cat as { specialization: Specialization; grade: CategoryGrade }) : null,
        },
        repoUrl: open ? s.repoUrl : null,
        commitSha: open ? s.commitSha : null,
        aiLogText: maskContacts(s.aiLogText ?? '').text,
        result: s.resultJson as ResultJson | null,
        defense: s.defenseInvitationId ? { invitationId: s.defenseInvitationId, invitationStatus: inv?.status ?? 'sent' } : null,
      };
    }),
  };
}

/**
 * «Пригласить на защиту»: приглашение в смысле ТЗ (вилка, R-D-01/02) по потребности задания +
 * ожидающая защита CallSession kind=defense, status=pending через defense-hook (defense-room/pending.ts). Только проверенный сабмит.
 */
export async function inviteToDefense(
  ctx: { companyId: string; employerProfileId: string },
  submissionId: string,
  input: InviteToDefenseInput,
): Promise<{ invitationId: string; callSessionId: string | null }> {
  const s = await prisma.projectSubmission.findUnique({ where: { id: submissionId }, include: { projectTask: { include: { vacancy: { select: { companyId: true } } } } } });
  if (!s || s.projectTask.vacancy.companyId !== ctx.companyId) throw errors.notFound('Сдача не найдена');
  if (s.status !== 'checked') throw errors.conflict('Позвать на защиту можно после автопроверки');
  if (s.defenseInvitationId) throw errors.conflict('Кандидат уже приглашён на защиту по этой сдаче');
  const inv = await createInvitation(ctx, {
    candidateId: s.candidateId,
    vacancyId: s.projectTask.vacancyId,
    message: input.message,
    salaryFrom: input.salaryFrom,
    salaryTo: input.salaryTo,
  });
  await prisma.projectSubmission.update({ where: { id: s.id }, data: { defenseInvitationId: inv.id } });
  const { callSessionId } = await getDefenseHook().requestDefense({ submissionId: s.id, candidateId: s.candidateId, invitationId: inv.id, companyId: ctx.companyId });
  return { invitationId: inv.id, callSessionId };
}
