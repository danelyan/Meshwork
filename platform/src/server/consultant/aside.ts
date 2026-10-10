import { SPEC_LABEL } from '@/lib/directions';
import { prisma } from '../db';
import { listVacancies, loadEmployerContext } from '../employer';
import type { OnboardingView } from '../onboarding/types';

// Данные правой колонки экрана консультанта: «Твой путь», «Что я уже знаю», «Рынок», «Документы», «Подсказка».
// Всё читается из существующих таблиц (опрос, утверждения, категория из теста, приглашения);
// отдельных API нет. Состояние считается на сервере при загрузке страницы.

export type StepState = 'done' | 'now' | 'next';

export interface JourneyStep {
  id: string;
  label: string;
  /** Короткая подпись для узкой полосы. */
  short: string;
  /** Что уже есть или что делать (строка под названием). */
  note: string;
  href: string;
  state: StepState;
}

export interface AsideDoc {
  id: string;
  name: string;
  kind: 'file' | 'link';
  /** «разобран, 3 утверждения» / «разбирается». */
  status: string;
}

/** Ответ из знакомства: короткое имя шага и ответ так, как он звучит в ленте. */
export interface KnownFact {
  stepId: string;
  label: string;
  value: string;
}

/** Строка «рынка»: категория (специализация × грейд) и сколько в ней; mine — совпадает с категорией/потребностью пользователя. */
export interface MarketRow {
  key: string;
  label: string;
  count: number;
  mine: boolean;
}

export interface SceneAsideData {
  role: 'candidate' | 'employer';
  steps: JourneyStep[];
  /** Что консультант уже узнал в знакомстве (ответы, без согласия и роли). */
  known?: KnownFact[];
  /** Кандидату — активные потребности компаний по категориям; работодателю — кандидаты с категорией по тесту. */
  market?: { total: number; rows: MarketRow[] };
  /** Загруженное кандидатом; у работодателя null (блок не показывается). */
  docs: AsideDoc[] | null;
  hint: { title: string; text: string };
}

type StepDraft = Omit<JourneyStep, 'state'> & { done: boolean };

/**
 * Первый незавершённый шаг — «сейчас», до него — «готово», после — «дальше».
 * Последний шаг («приглашения») не бывает «готов»: если все предыдущие пройдены, он «сейчас».
 */
export function markStates(drafts: StepDraft[]): JourneyStep[] {
  const nowIdx = drafts.findIndex((d, i) => !d.done || i === drafts.length - 1);
  return drafts.map((d, i) => ({ id: d.id, label: d.label, short: d.short, note: d.note, href: d.href, state: i < nowIdx ? 'done' : i === nowIdx ? 'now' : 'next' }));
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
export const claimsWord = (n: number) => `${n} ${plural(n, 'утверждение', 'утверждения', 'утверждений')}`;
const invitesWord = (n: number) => `${n} ${plural(n, 'приглашение', 'приглашения', 'приглашений')}`;

/** Знакомство завершено: шагов нет совсем (аккаунт без ленты) или показан итог. */
export function introDone(view: OnboardingView | undefined): boolean {
  return !view || (view.onboarded && view.current.kind === 'summary');
}

const SPEC: Record<string, string> = SPEC_LABEL;
const GRADE: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };
const GRADE_ORDER = ['junior', 'middle', 'senior'];

const HIDDEN_FACTS = new Set(['consent', 'role']);

/** Ответы знакомства: из итога, если он показан, иначе из истории ленты (пропущенные не берём). */
export function knownFacts(view: OnboardingView | undefined): KnownFact[] {
  if (!view) return [];
  if (view.summary) return view.summary.items.filter((i) => !HIDDEN_FACTS.has(i.stepId)).map((i) => ({ stepId: i.stepId, label: i.label, value: i.value }));
  return view.history
    .filter((h) => h.answer !== null && h.label && !HIDDEN_FACTS.has(h.stepId))
    .map((h) => ({ stepId: h.stepId, label: h.label as string, value: h.answer as string }));
}

/** Группировка по специализации × грейду; сортировка: свои сверху, потом по специализации и грейду. */
export function marketRows(items: { specialization: string; grade: string }[], mine: (spec: string, grade: string) => boolean): { total: number; rows: MarketRow[] } {
  const counts = new Map<string, { specialization: string; grade: string; count: number }>();
  for (const it of items) {
    const key = `${it.specialization}:${it.grade}`;
    const row = counts.get(key) ?? { specialization: it.specialization, grade: it.grade, count: 0 };
    row.count += 1;
    counts.set(key, row);
  }
  const order = (key: string) => key.replace(/:(\w+)$/, (_, g: string) => `:${GRADE_ORDER.indexOf(g)}`);
  const rows: MarketRow[] = [...counts.entries()].map(([key, r]) => ({
    key,
    label: `${SPEC[r.specialization] ?? r.specialization} · ${GRADE[r.grade] ?? r.grade}`,
    count: r.count,
    mine: mine(r.specialization, r.grade),
  }));
  rows.sort((a, b) => Number(b.mine) - Number(a.mine) || order(a.key).localeCompare(order(b.key)));
  return { total: items.length, rows };
}

export interface CandidateFacts {
  intro: boolean;
  introNote: string;
  confirmed: number;
  category: { specialization: string; grade: string } | null;
  invitations: number;
}

export function candidateSteps(f: CandidateFacts): JourneyStep[] {
  return markStates([
    { id: 'intro', label: 'Знакомство', short: 'Знакомство', note: f.introNote, href: '/consultant', done: f.intro },
    {
      id: 'profile',
      label: 'Профиль',
      short: 'Профиль',
      note: f.confirmed > 0 ? `подтверждено: ${claimsWord(f.confirmed)}` : 'добавь резюме или ссылки и подтверди утверждения',
      href: '/profile',
      done: f.confirmed > 0,
    },
    {
      id: 'test',
      label: 'Тест на грейд',
      short: 'Тест',
      note: f.category ? `${SPEC[f.category.specialization] ?? f.category.specialization} · ${GRADE[f.category.grade] ?? f.category.grade}` : 'категорию даёт только тест',
      href: '/test',
      done: f.category !== null,
    },
    {
      id: 'invites',
      label: 'Категория и приглашения',
      short: 'Приглашения',
      note: f.invitations > 0 ? invitesWord(f.invitations) : 'работодатели находят тебя сами',
      href: '/invitations',
      done: false,
    },
  ]);
}

export interface EmployerFacts {
  intro: boolean;
  introNote: string;
  needs: number;
  invitations: number;
}

export function employerSteps(f: EmployerFacts): JourneyStep[] {
  return markStates([
    { id: 'intro', label: 'Компания', short: 'Компания', note: f.introNote, href: '/consultant', done: f.intro },
    {
      id: 'needs',
      label: 'Потребность',
      short: 'Потребность',
      note: f.needs > 0 ? `активных: ${f.needs}` : 'опиши, кто нужен',
      href: f.needs > 0 ? '/employer' : '/employer/needs/new',
      done: f.needs > 0,
    },
    { id: 'search', label: 'Поиск по базе', short: 'Поиск', note: 'подборка с обоснованием по каждому кандидату', href: '/employer/search', done: f.invitations > 0 },
    { id: 'invites', label: 'Приглашения', short: 'Приглашения', note: f.invitations > 0 ? `отправлено: ${f.invitations}` : 'вилка и способ связи — в самом приглашении', href: '/employer/invitations', done: false },
  ]);
}

const introNote = (view: OnboardingView | undefined, done: boolean) =>
  done || !view ? 'пройдено' : `${view.progress.done} из ${view.progress.total}${view.later ? ', на паузе' : ''}`;

/** Подсказка по текущему шагу. Тексты — из существующих описаний экранов и шагов знакомства. */
export function hintFor(role: 'candidate' | 'employer', steps: JourneyStep[], view: OnboardingView | undefined): { title: string; text: string } {
  const now = steps.find((s) => s.state === 'now');
  if (now?.id === 'intro' && view) {
    const c = view.current;
    return { title: c.label || 'Знакомство', text: c.sub ?? c.question };
  }
  if (role === 'candidate') {
    if (now?.id === 'profile') return { title: 'Профиль', text: 'Каждое утверждение попадает в профиль только после твоего подтверждения. Прикрепи резюме или ссылку - консультант предложит, что подтвердить.' };
    if (now?.id === 'test') return { title: 'Тест на грейд', text: 'Специализацию и грейд определяет только тест, а не резюме и не ответы в чате.' };
    return { title: 'Приглашения', text: 'Компании сами находят тебя по подтверждённым карточкам и пишут вилку и способ связи - всё это видно до того, как ты ответишь.' };
  }
  if (now?.id === 'needs') return { title: 'Потребность', text: 'Опиши, кто нужен, - и платформа подберёт кандидатов с обоснованием.' };
  return { title: now?.label ?? 'Подбор', text: 'Ищи по подтверждённым карточкам и отправляй приглашение с вилкой зарплаты; контакты кандидата открываются после его согласия.' };
}

/** Документы кандидата: файлы (Upload) и подключённые ссылки (Source) со статусом разбора. */
export async function loadCandidateDocs(candidateId: string): Promise<AsideDoc[]> {
  const [uploads, sources, claims] = await Promise.all([
    prisma.upload.findMany({ where: { candidateId }, select: { id: true, filename: true, extracted: true }, orderBy: { createdAt: 'desc' }, take: 8 }),
    prisma.source.findMany({ where: { candidateId, kind: { in: ['url', 'github', 'codeforces', 'stackoverflow'] } }, select: { id: true, origin: true, claims: { where: { status: { not: 'rejected' } }, select: { id: true } } }, orderBy: { fetchedAt: 'desc' }, take: 4 }),
    prisma.claim.findMany({ where: { candidateId, status: { not: 'rejected' } }, select: { sourceRef: true } }),
  ]);
  const status = (n: number) => (n > 0 ? `разобран, ${claimsWord(n)}` : 'разобран, утверждений нет');
  const files = uploads.map((u): AsideDoc => {
    const n = claims.filter((c) => c.sourceRef.startsWith(`${u.filename}#`)).length;
    return { id: u.id, name: u.filename, kind: 'file', status: u.extracted ? status(n) : 'разбирается' };
  });
  const links = sources.map((s): AsideDoc => ({ id: s.id, name: s.origin.replace(/^https?:\/\//, ''), kind: 'link', status: status(s.claims.length) }));
  return [...files, ...links];
}

export async function loadCandidateAside(candidateId: string, view: OnboardingView | undefined): Promise<SceneAsideData> {
  const [profileClaims, category, invitations, docs, vacancies] = await Promise.all([
    prisma.claim.count({ where: { candidateId, status: { in: ['confirmed', 'edited'] } } }),
    prisma.candidateCategory.findFirst({ where: { candidateId }, orderBy: { confirmedAt: 'desc' }, select: { specialization: true, grade: true } }),
    prisma.invitation.count({ where: { candidateId } }),
    loadCandidateDocs(candidateId),
    prisma.vacancy.findMany({ where: { archivedAt: null }, select: { specialization: true, grade: true } }),
  ]);
  const intro = introDone(view);
  const steps = candidateSteps({ intro, introNote: introNote(view, intro), confirmed: profileClaims, category, invitations });
  const market = marketRows(vacancies, (spec, grade) => category?.specialization === spec && category.grade === grade);
  return { role: 'candidate', steps, known: knownFacts(view), market, docs, hint: hintFor('candidate', steps, view) };
}

export async function loadEmployerAside(employerProfileId: string, view: OnboardingView | undefined): Promise<SceneAsideData> {
  const ctx = await loadEmployerContext(employerProfileId);
  const [vacancies, invitations, categories] = await Promise.all([
    listVacancies(ctx.companyId),
    prisma.invitation.count({ where: { companyId: ctx.companyId } }),
    prisma.candidateCategory.findMany({ orderBy: { confirmedAt: 'desc' }, select: { candidateId: true, specialization: true, grade: true } }),
  ]);
  const active = vacancies.filter((v) => !v.archived);
  const intro = introDone(view);
  const steps = employerSteps({ intro, introNote: introNote(view, intro), needs: active.length, invitations });
  // категория кандидата — последняя по тесту; пересдачи не считаем дважды
  const latest = new Map<string, { specialization: string; grade: string }>();
  for (const c of categories) if (!latest.has(c.candidateId)) latest.set(c.candidateId, c);
  const market = marketRows([...latest.values()], (spec, grade) => active.some((v) => v.specialization === spec && v.grade === grade));
  return { role: 'employer', steps, known: knownFacts(view), market, docs: null, hint: hintFor('employer', steps, view) };
}
