import type { Prisma } from '@prisma/client';

import { getSubcategory, isSpecialization, SPEC_ROLE, subcategoryMatches } from '@/lib/directions';
import { CONSENT_VERSION, hasCurrentConsent, recordConsent } from '@/server/auth/consent';
import { chooseRole } from '@/server/auth/users';
import { grantConsent } from '@/server/consent/service';
import { CANDIDATE_ONBOARDING_KINDS, EMPLOYER_ONBOARDING_KINDS, consentVersion, type ConsentKindName } from '@/server/consent/texts';
import { demoAchievements } from '@/server/collector/fsp-demo';
import { prisma } from '@/server/db';
import { AppError, errors } from '@/server/errors';
import { loadCatalog } from '@/server/recommend/evidence';
import { recommendTest } from '@/server/recommend/test';
import type { Grade, Specialization } from '@/server/types';

import {
  AnswerError,
  type EngineState,
  answerLabel,
  currentStep,
  factLabel,
  historyOf,
  isAnswered,
  isClosed,
  nextOpen,
  optionsOf,
  progress,
  validateAnswer,
  visibleSteps,
} from './engine';
import { computeNeeds } from './needs';
import { type PrevAnswer, leadFor, templateLead } from './phrase';
import { GRADES, findStep, scenarioSteps } from './scenario';
import type { Answers, Facts, OnboardingView, StepContext, StepDef, StepView, SummaryView } from './types';
import { GRADE_LABEL } from '@/lib/grades';

/**
 * Онбординг-чат: состояние в OnboardingState, ответы — сразу в целевые модели
 * (Candidate, CandidateProfile, Company, Vacancy). Контракт роутов —
 * app/api/onboarding/route.ts. «Настроить позже» не вызывает markOnboarded.
 */

/** Роут теста на грейд (лейн test). null — роута ещё нет: ведём в профиль с пометкой. */
export const GRADE_TEST_PATH: string | null = '/test';

const CABINET = { candidate: '/consultant', employer: '/employer' } as const;

/**
 * Служебное состояние: вакансии работодателя; `later` — пауза знакомства («Настроить позже»); `doneRoles` — роли
 * учётки с завершённым знакомством (пишет переключение роли, ADR 0004; правки meta здесь его сохраняют).
 */
type Meta = {
  vacancies?: Partial<Record<Grade, string>>;
  later?: boolean;
  doneRoles?: ('candidate' | 'employer')[];
  /** Шаг, пауза и итог неактивной роли (ADR 0004, `swapRoleOnboarding`); правки meta здесь его сохраняют. */
  byRole?: Record<string, unknown>;
};

/** Шаг онбординга сделан (ответ, пропуск, возврат) — пауза «Настроить позже» снята. */
function resumed(meta: Meta): Meta {
  if (!meta.later) return meta;
  const rest = { ...meta };
  delete rest.later;
  return rest;
}

async function load(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      employerProfile: { select: { id: true, companyId: true } },
      candidate: { select: { id: true, fspState: true, specialization: true, subcategoryId: true, contact: true, profile: true } },
      onboarding: true,
    },
  });
  if (!user) throw errors.notFound('Аккаунт не найден');
  const consent = await hasCurrentConsent(userId);
  const decided = new Set(
    (await prisma.consent.findMany({ where: { userId, kind: { in: [...CANDIDATE_ONBOARDING_KINDS, ...EMPLOYER_ONBOARDING_KINDS] } }, select: { kind: true }, distinct: ['kind'] })).map((c) => c.kind as string),
  );
  const facts: Facts = {
    role: user.role,
    consent,
    candidateConsents: CANDIDATE_ONBOARDING_KINDS.some((k) => decided.has(k)),
    employerConsents: EMPLOYER_ONBOARDING_KINDS.some((k) => decided.has(k)),
    name: user.name,
    fspState: user.candidate?.fspState ?? null,
    specialization: user.candidate?.specialization ?? null,
  };
  const st = user.onboarding;
  // Ready demo/imported accounts may have a real questionnaire profile but no
  // onboarding answers. Use stored values for editing, without writing/resetting it.
  const recovered: Answers = {};
  if (user.role === 'candidate' && user.onboardedAt && user.candidate) {
    const c = user.candidate;
    const p = c.profile;
    const values: Answers = { specialization: c.specialization, subcategory: c.subcategoryId, fsp: c.fspState, candidateContact: c.contact,
      goal: p?.goal, grade: p?.claimedGrade, stack: p?.stack, formats: p?.workFormats, city: p?.city, fspParticipation: p?.fspParticipation };
    if (p?.salaryMin != null && p.salaryExpected != null) values.salary = { from: p.salaryMin / 1000, to: p.salaryExpected / 1000 };
    for (const [key, value] of Object.entries(values)) if (value != null && (!Array.isArray(value) || value.length)) recovered[key] = value;
  }
  const state: EngineState = {
    stepId: st?.stepId ?? null,
    answers: { ...((st?.answers as Answers | undefined) ?? {}), ...recovered },
    skipped: st?.skipped ?? [],
  };
  return {
    user,
    state,
    ctx: { answers: state.answers, facts } satisfies StepContext,
    lines: (st?.lines as Record<string, string> | undefined) ?? {},
    meta: (st?.meta as Meta | undefined) ?? {},
  };
}
type Loaded = Awaited<ReturnType<typeof load>>;

/** City is conditional during first onboarding, but is always editable in a ready own profile. */
function completedProfileStep(l: Loaded, stepId: string | null): StepDef | undefined {
  if (stepId !== 'city' || l.user.role !== 'candidate' || !l.user.candidateId || !l.user.onboardedAt || !l.ctx.facts.consent) return undefined;
  return findStep(stepId);
}

async function save(userId: string, data: { stepId: string; answers?: Answers; skipped?: string[]; lines?: Record<string, string>; meta?: Meta }) {
  const json = (v: unknown) => v as Prisma.InputJsonValue;
  const patch = {
    stepId: data.stepId,
    ...(data.answers ? { answers: json(data.answers) } : {}),
    ...(data.skipped ? { skipped: data.skipped } : {}),
    ...(data.lines ? { lines: json(data.lines) } : {}),
    ...(data.meta ? { meta: json(data.meta) } : {}),
  };
  await prisma.onboardingState.upsert({ where: { userId }, create: { userId, ...patch }, update: patch });
}

function prevOf(step: StepDef, l: Pick<Loaded, 'ctx' | 'state' | 'lines'>): PrevAnswer | null {
  const steps = visibleSteps(l.ctx);
  const idx = steps.findIndex((s) => s.id === step.id);
  for (let i = idx - 1; i >= 0; i--) {
    const s = steps[i]!;
    if (!isClosed(s, l.ctx, l.state.skipped)) continue;
    const answered = isAnswered(s, l.ctx.answers);
    const value = answered ? l.ctx.answers[s.id] : s.doneBy?.(l.ctx) ? true : undefined;
    return { step: s, value, label: answered ? answerLabel(s, value, l.ctx) : null };
  }
  // Шаг согласия (страховка) уже показан и после ответа скрылся из сценария: первый видимый шаг
  // не должен здороваться второй раз.
  const consent = findStep('consent');
  if (consent && l.lines.consent) return { step: consent, value: true, label: null };
  return null;
}

async function gradeHint(candidateId: string | null): Promise<string | undefined> {
  if (!candidateId) return undefined;
  const n = await prisma.claim.count({ where: { candidateId, status: { in: ['confirmed', 'edited'] } } });
  if (n === 0) return 'Подтверди утверждения из документов - и я подскажу грейд по ним.';
  try {
    const rec = await recommendTest(candidateId);
    const g = GRADES.find((x) => x.value === rec.grade)?.label ?? rec.grade;
    return `По подтверждённым утверждениям (${n}) советую ${g}. ${rec.reason}`;
  } catch {
    return undefined;
  }
}

function summaryOf(l: Loaded): SummaryView {
  const steps = visibleSteps(l.ctx).filter((s) => s.kind !== 'summary');
  const items: SummaryView['items'] = [];
  const skipped: SummaryView['skipped'] = [];
  for (const s of steps) {
    if (isAnswered(s, l.ctx.answers)) {
      if (s.kind === 'consent') continue;
      items.push({ stepId: s.id, label: s.summaryLabel, value: answerLabel(s, l.ctx.answers[s.id], l.ctx) });
    } else if (s.doneBy?.(l.ctx)) {
      if (s.kind === 'consent') continue;
      items.push({ stepId: s.id, label: s.summaryLabel, value: factLabel(s, l.ctx) });
    } else {
      skipped.push({ stepId: s.id, label: s.summaryLabel });
    }
  }
  const warnings: string[] = [];
  const { scenario } = scenarioSteps(l.ctx);
  if (scenario === 'employer' && !Object.keys(l.meta.vacancies ?? {}).length) {
    warnings.push('Потребность ещё не сохранена: нужны направление, грейд и вилка.');
  }
  if (scenario === 'candidate' && !l.ctx.facts.specialization) {
    warnings.push('Без направления не получится подобрать тест на грейд.');
  }
  return { items, skipped, warnings };
}

function laterTarget(l: Loaded): string {
  if (l.ctx.facts.role === 'pending' || !l.ctx.facts.consent) return '/';
  return CABINET[l.ctx.facts.role];
}

/** Вид онбординга. Генерирует (и запоминает) реплику помощника для текущего шага. */
export async function getView(userId: string, signal?: AbortSignal): Promise<OnboardingView> {
  const l = await load(userId);
  const current = completedProfileStep(l, l.state.stepId) ?? currentStep(l.ctx, l.state);
  let lines = l.lines;
  if (!lines[current.id]) {
    const lead = await leadFor(current, l.ctx, prevOf(current, l), { candidateId: l.user.candidateId, signal });
    lines = { ...lines, [current.id]: lead };
    await save(userId, { stepId: current.id, lines });
  } else if (l.state.stepId !== current.id) {
    await save(userId, { stepId: current.id });
  }

  const view: StepView = {
    id: current.id,
    kind: current.kind,
    eyebrow: current.eyebrow,
    label: current.summaryLabel,
    question: current.question,
    ...(current.sub ? { sub: current.sub } : {}),
    lead: lines[current.id] ?? '',
    allowCustom: Boolean(current.allowCustom),
    required: Boolean(current.required),
    ...(current.options ? { options: optionsOf(current, l.ctx) } : {}),
    ...(isAnswered(current, l.ctx.answers) ? { value: l.ctx.answers[current.id] } : {}),
    ...(current.range ? { range: current.range } : {}),
    ...(current.maxLength ? { maxLength: current.maxLength } : {}),
    ...(current.placeholder ? { placeholder: current.placeholder } : {}),
  };
  if (current.id === 'grade') {
    const hint = await gradeHint(l.user.candidateId);
    if (hint) view.hint = hint;
  }
  if (current.id === 'fsp' && l.user.candidateId) view.fspDemo = demoAchievements(l.user.candidateId);

  const history = historyOf(l.ctx, l.state, current).map((s) => {
    const answered = isAnswered(s, l.ctx.answers);
    const skipped = !answered && !s.doneBy?.(l.ctx);
    return {
      stepId: s.id,
      label: s.summaryLabel,
      lead: lines[s.id] ?? templateLead(s, l.ctx, prevOf(s, l)),
      question: s.question,
      answer: answered ? answerLabel(s, l.ctx.answers[s.id], l.ctx) : skipped ? null : factLabel(s, l.ctx),
      editable: !s.doneBy?.(l.ctx) && s.kind !== 'consent' && s.kind !== 'consents' && s.kind !== 'role',
    };
  });

  return {
    name: l.user.name,
    role: l.ctx.facts.role,
    scenario: scenarioSteps(l.ctx).scenario,
    consent: { version: CONSENT_VERSION, docUrl: '/consent' },
    progress: progress(l.ctx, l.state.skipped),
    history,
    current: view,
    summary: current.kind === 'summary' ? summaryOf(l) : null,
    laterTarget: laterTarget(l),
    test: { href: GRADE_TEST_PATH ?? '/profile', ready: GRADE_TEST_PATH !== null },
    onboarded: l.user.onboardedAt !== null,
    later: isPaused(l),
  };
}

function stepOr409(l: Loaded, stepId: string): StepDef {
  const step = visibleSteps(l.ctx).find((s) => s.id === stepId) ?? completedProfileStep(l, stepId);
  if (!step) throw errors.conflict('Этот вопрос сейчас недоступен - обнови страницу');
  return step;
}

export interface MutationResult {
  /** Роль сменилась — перевыпустить куку сессии (userSessionCookie(sessionInputFor(user))). */
  sessionChanged: boolean;
}

async function companyIdOf(userId: string): Promise<string> {
  const p = await prisma.employerProfile.findUnique({ where: { userId }, select: { companyId: true } });
  if (!p) throw errors.conflict('Сначала укажи компанию');
  return p.companyId;
}

function candidateIdOf(l: Loaded): string {
  if (!l.user.candidateId) throw errors.conflict('Сначала выбери роль');
  return l.user.candidateId;
}

async function upsertProfile(candidateId: string, data: Omit<Prisma.CandidateProfileUncheckedCreateInput, 'candidateId'>) {
  await prisma.candidateProfile.upsert({ where: { candidateId }, create: { candidateId, ...data }, update: data });
}

/** Запись ответа в целевую модель. */
async function apply(l: Loaded, step: StepDef, value: unknown): Promise<boolean> {
  const userId = l.user.id;
  const range = (v: unknown) => {
    const r = v as { from: number; to: number };
    const k = step.range!.scale;
    return { from: r.from * k, to: r.to * k };
  };
  switch (step.id) {
    case 'consent':
      await recordConsent(userId, (value as { version: string }).version);
      return false;
    case 'candidateConsents':
    case 'employerConsents': {
      // ADR 0005: каждая отмеченная галочка — своё согласие текущей версии. Без Г4 профиль скрыт от работодателей.
      for (const kind of value as ConsentKindName[]) await grantConsent(userId, { kind, version: consentVersion(kind) });
      if (step.id === 'candidateConsents' && !(value as string[]).includes('employer_visibility')) {
        await prisma.candidate.update({ where: { id: candidateIdOf(l) }, data: { hiddenFromEmployers: true } });
      }
      return false;
    }
    case 'role':
      if (l.ctx.facts.role !== 'pending') throw errors.conflict('Роль уже выбрана');
      if (value === 'candidate') {
        await chooseRole(userId, { role: 'candidate' });
        return true;
      }
      return false; // работодатель: компания создаётся на шаге companyName
    case 'companyName':
      if (l.ctx.facts.role === 'pending') {
        await chooseRole(userId, { role: 'employer', companyName: value as string });
        return true;
      }
      await prisma.company.update({ where: { id: await companyIdOf(userId) }, data: { name: value as string } });
      return false;
    case 'inn':
    case 'industry':
    case 'about':
    case 'contact': {
      const field = { inn: 'inn', industry: 'industry', about: 'description', contact: 'contact' }[step.id];
      await prisma.company.update({ where: { id: await companyIdOf(userId) }, data: { [field]: value as string } });
      return false;
    }
    case 'goal':
      await upsertProfile(candidateIdOf(l), { goal: value as 'job_search' });
      return false;
    case 'grade':
      await upsertProfile(candidateIdOf(l), { claimedGrade: value as Grade });
      return false;
    case 'stack':
      await upsertProfile(candidateIdOf(l), { stack: value as string[] });
      return false;
    case 'formats':
      await upsertProfile(candidateIdOf(l), { workFormats: value as ('remote' | 'hybrid' | 'office' | 'relocation')[] });
      return false;
    case 'city':
      await upsertProfile(candidateIdOf(l), { city: value as string });
      return false;
    case 'salary': {
      const r = range(value);
      await upsertProfile(candidateIdOf(l), { salaryMin: r.from, salaryExpected: r.to });
      return false;
    }
    case 'candidateContact':
      await prisma.candidate.update({ where: { id: candidateIdOf(l) }, data: { contact: value as string } });
      return false;
    case 'fspParticipation':
      await upsertProfile(candidateIdOf(l), { fspParticipation: value as 'prize' | 'participant' | 'none' });
      return false;
    case 'specialization': {
      // Подкатегория чужого направления сбрасывается (смена направления возвратом к шагу).
      const id = candidateIdOf(l);
      const cur = await prisma.candidate.findUnique({ where: { id }, select: { subcategoryId: true } });
      const spec = value as Specialization;
      await prisma.candidate.update({
        where: { id },
        data: { specialization: spec, ...(subcategoryMatches(spec, cur?.subcategoryId) ? {} : { subcategoryId: null }) },
      });
      return false;
    }
    case 'subcategory':
      await prisma.candidate.update({ where: { id: candidateIdOf(l) }, data: { subcategoryId: value as string } });
      return false;
    case 'fsp':
      await prisma.candidate.update({ where: { id: candidateIdOf(l) }, data: { fspState: value as 'linked' | 'no_achievements' | 'not_linked' } });
      return false;
    case 'documents':
      candidateIdOf(l); // файлы и утверждения уже записал конвейер консультанта
      return false;
    default:
      return false; // need*: синхронизирует syncVacancies после записи ответа
  }
}

const GRADE_TITLE: Record<Grade, string> = GRADE_LABEL;

/**
 * Потребность работодателя → Vacancy (по одной на выбранный грейд). Пишется, когда
 * известны направление, грейды и вилка (поля Vacancy обязательные). Снятый грейд:
 * вакансия удаляется, если по ней нет приглашений, иначе остаётся как есть.
 */
export async function syncVacancies(userId: string, answers: Answers, meta: Meta): Promise<Meta> {
  const rawSpec = answers.needSpecialization;
  const grades = answers.needGrades;
  const salary = answers.needSalary as { from: number; to: number } | undefined;
  if (!isSpecialization(rawSpec) || !Array.isArray(grades) || grades.length === 0 || !salary) return meta;
  const spec: Specialization = rawSpec;
  const rawSub = answers.needSubcategory;
  const subcategoryId = typeof rawSub === 'string' && getSubcategory(rawSub)?.specialization === spec ? rawSub : null;
  const companyId = await companyIdOf(userId);
  const entries = [...(await loadCatalog()).values()];
  const stack = Array.isArray(answers.needStack) ? (answers.needStack as string[]) : [];
  const team = typeof answers.needTeam === 'string' ? answers.needTeam : null;
  const vacancies: Partial<Record<Grade, string>> = { ...(meta.vacancies ?? {}) };
  for (const grade of grades as Grade[]) {
    const data = {
      title: `${SPEC_ROLE[spec]} (${GRADE_TITLE[grade]})`,
      specialization: spec,
      subcategoryId,
      grade,
      salaryFrom: salary.from * 1000,
      salaryTo: salary.to * 1000,
      needs: computeNeeds(entries, spec, grade, stack) as unknown as Prisma.InputJsonValue,
      stack,
      teamDescription: team,
    };
    const existing = vacancies[grade]
      ? await prisma.vacancy.findFirst({ where: { id: vacancies[grade], companyId }, select: { id: true } })
      : null;
    if (existing) await prisma.vacancy.update({ where: { id: existing.id }, data });
    else vacancies[grade] = (await prisma.vacancy.create({ data: { ...data, companyId }, select: { id: true } })).id;
  }
  for (const g of Object.keys(vacancies) as Grade[]) {
    if ((grades as string[]).includes(g)) continue;
    const id = vacancies[g]!;
    const invited = await prisma.invitation.count({ where: { vacancyId: id } });
    if (invited === 0) await prisma.vacancy.deleteMany({ where: { id, companyId } });
    delete vacancies[g];
  }
  return { ...meta, vacancies };
}

export async function answerStep(userId: string, stepId: string, value: unknown): Promise<MutationResult> {
  const l = await load(userId);
  const step = stepOr409(l, stepId);
  if (step.kind === 'summary') throw errors.conflict('На итог не отвечают');
  let parsed: unknown;
  try {
    parsed = validateAnswer(step, value, l.ctx);
  } catch (err) {
    if (err instanceof AnswerError) throw new AppError('validation_failed', err.message, 400);
    throw err;
  }
  const sessionChanged = await apply(l, step, parsed);
  const answers = { ...l.state.answers, [step.id]: parsed };
  const skipped = l.state.skipped.filter((s) => s !== step.id);
  let meta = resumed(l.meta);
  if (step.id.startsWith('need')) meta = await syncVacancies(userId, answers, meta);
  // Факты могли измениться (согласие, роль, ФСП) — следующий шаг считаем по свежим.
  const fresh = await load(userId);
  const ctx = { ...fresh.ctx, answers };
  const next = nextOpen(ctx, skipped, step.id);
  await save(userId, { stepId: next.id, answers, skipped, meta });
  return { sessionChanged };
}

export async function skipStep(userId: string, stepId: string): Promise<MutationResult> {
  const l = await load(userId);
  const step = stepOr409(l, stepId);
  if (step.required || step.kind === 'summary') throw errors.conflict('Этот шаг нельзя пропустить');
  const skipped = isAnswered(step, l.ctx.answers) || l.state.skipped.includes(step.id) ? l.state.skipped : [...l.state.skipped, step.id];
  const next = nextOpen(l.ctx, skipped, step.id);
  await save(userId, { stepId: next.id, skipped, ...(l.meta.later ? { meta: resumed(l.meta) } : {}) });
  return { sessionChanged: false };
}

/** Вернуться к шагу (из итога — к пропущенному, или поправить ответ). */
export async function gotoStep(userId: string, stepId: string): Promise<MutationResult> {
  const l = await load(userId);
  const step = stepOr409(l, stepId);
  if (step.kind !== 'summary' && step.doneBy?.(l.ctx)) throw errors.conflict('Этот шаг уже пройден');
  await save(userId, { stepId: step.id, ...(l.meta.later ? { meta: resumed(l.meta) } : {}) });
  return { sessionChanged: false };
}

/** Пауза знакомства имеет смысл у кандидата и работодателя с незавершённым онбордингом (до выбора роли — нет). */
function isPaused(l: Loaded): boolean {
  return l.meta.later === true && (l.ctx.facts.role === 'candidate' || l.ctx.facts.role === 'employer') && l.user.onboardedAt === null;
}

/** Роль, у которой «Настроить позже» — пауза в ленте /consultant, а не уход со страницы. */
function pausable(l: Loaded): boolean {
  return (l.ctx.facts.role === 'candidate' || l.ctx.facts.role === 'employer') && l.ctx.facts.consent && l.user.onboardedAt === null;
}

/**
 * «Настроить позже»: ответы уже сохранены; онбординг не завершаем. Кандидат (решение владельца
 * 10.10) и работодатель (решение владельца 10.10, тот же механизм) остаются на /consultant: шаги на
 * паузе (meta.later), лента — свободный разговор с консультантом / помощником по подбору; вернуться —
 * ответить, пропустить или открыть шаг (goto). Остальным — куда вести, как раньше.
 */
export async function finishLater(userId: string): Promise<{ next: string }> {
  const l = await load(userId);
  if (pausable(l)) {
    await save(userId, { stepId: l.state.stepId ?? currentStep(l.ctx, l.state).id, meta: { ...l.meta, later: true } });
    return { next: '/consultant' };
  }
  return { next: laterTarget(l) };
}

/** Текущий шаг онбординга для хода консультанта (свободный вопрос посреди шага, напоминание). */
export interface OnboardingStepBrief {
  stepId: string;
  question: string;
  /** Пояснение под вопросом (зачем спрашиваем). */
  sub?: string;
  /** Доступные варианты с пояснением из сценария: «Ищу работу (хочу приглашения от компаний)». */
  options: string[];
}

function briefOf(step: StepDef, ctx: StepContext): OnboardingStepBrief | null {
  if (step.kind === 'summary') return null;
  return {
    stepId: step.id,
    question: step.question,
    ...(step.sub ? { sub: step.sub } : {}),
    options: optionsOf(step, ctx)
      .filter((o) => !o.disabled)
      .map((o) => (o.note ? `${o.label} (${o.note})` : o.label)),
  };
}

/**
 * Контекст свободного вопроса посреди онбординга: согласие и роль (граница доверия — до них
 * текст в модель не уходит) и шаг, на котором человек сейчас. step = null — человек на итоге.
 */
export async function asideContext(userId: string): Promise<{ consent: boolean; role: Facts['role']; step: OnboardingStepBrief | null }> {
  const l = await load(userId);
  return { consent: l.ctx.facts.consent, role: l.ctx.facts.role, step: briefOf(currentStep(l.ctx, l.state), l.ctx) };
}

/**
 * Онбординг кандидата не закончен («Настроить позже» или ушёл посреди) — шаг, с которого
 * продолжить (/onboarding откроется на нём). null — закончен или аккаунта входа нет.
 */
export async function pendingOnboarding(candidateId: string): Promise<OnboardingStepBrief | null> {
  const user = await prisma.user.findUnique({ where: { candidateId }, select: { id: true, onboardedAt: true } });
  if (!user || user.onboardedAt) return null;
  const l = await load(user.id);
  const step = currentStep(l.ctx, l.state);
  return briefOf(step, l.ctx) ?? { stepId: 'summary', question: 'Проверить сводку и завершить знакомство', options: [] };
}

/**
 * Знакомство работодателя на паузе («Настроить позже») — шаг, на котором остановился; null — не на
 * паузе. По нему ход помощника ставит маркер паузы (pauseMark) и сообщения видны под этим шагом.
 */
export async function pausedOnboardingOf(userId: string): Promise<OnboardingStepBrief | null> {
  const l = await load(userId);
  if (!isPaused(l)) return null;
  const step = currentStep(l.ctx, l.state);
  return briefOf(step, l.ctx) ?? { stepId: 'summary', question: 'Проверить сводку и завершить знакомство', options: [] };
}

/**
 * Показывать ли шаги онбординга в ленте /consultant (решения владельца 10.10: один адрес с чатом).
 * Да — роль не выбрана, знакомство не завершено или завершено в чате (состояние стоит на итоге:
 * шаги — начало ленты, дальше разговор). Нет — аккаунт завершён без чата (сид демо) или со старым
 * состоянием посреди шагов (открывал прежнюю /onboarding после завершения): такому кандидату —
 * обычный чат, работодателю — кабинет; иначе жюри под демо-аккаунтом увидело бы вопросы.
 */
export async function onboardingInFeed(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, onboardedAt: true, onboarding: { select: { stepId: true } } } });
  if (!user) return false;
  return user.role === 'pending' || user.onboardedAt === null || user.onboarding?.stepId === 'summary';
}

/**
 * Сколько шагов знакомства закрыто и сколько их в сценарии роли (для плашки «заполнено N из M»).
 * Пропущенный шаг считается закрытым. Без побочных эффектов — реплики помощника не генерируются.
 */
export async function onboardingProgress(userId: string): Promise<{ done: number; total: number }> {
  const l = await load(userId);
  return progress(l.ctx, l.state.skipped);
}
