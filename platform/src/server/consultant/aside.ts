import { SPEC_LABEL } from '@/lib/directions';
import { gradeLabel } from '@/lib/grades';
import { prisma } from '../db';
import { journeyState } from '../agent/journey';
import { listVacancies, loadEmployerContext } from '../employer';
import type { OnboardingView } from '../onboarding/types';
import { listMemory, MEMORY_LIMIT, type MemoryItem, type MemoryOwner, memoryPending } from './memory';
import { loadConsultantSettings } from './settings';
import type { ConsultantSettingsData } from './skills';

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
  /** Файл: оригинал сохранён — можно скачать (GET /api/uploads/:id/file). У ссылок и старых загрузок нет. */
  hasFile?: boolean;
}

/** Откуда пункт карточки «Что я о тебе знаю»: ответ знакомства, запомнено из чата, добавлено вручную. */
export type KnownSource = 'onboarding' | 'chat' | 'user';

/**
 * Пункт карточки «Что я о тебе знаю». Знакомство — производное (ответ шага; поправить = вернуться к шагу
 * в ленте, удалить нельзя); chat/user — строки ConsultantMemory (поправить и удалить через /api/consultant/memory).
 */
export interface KnownFact {
  /** Знакомство — `step:<stepId>`, память — id строки. */
  id: string;
  source: KnownSource;
  /** Только у знакомства: шаг, к которому ведёт «изменить». */
  stepId?: string;
  /** Знакомство — имя шага; память — пусто (подпись источника рисует карточка). */
  label: string;
  value: string;
  /** Можно поправить: у знакомства — шаг открывается в ленте; у памяти — всегда. */
  editable: boolean;
  /** Когда запомнено (только память) — для подсветки «новое». */
  createdAt?: string;
}

/** Метрика сводки на сцене: число или короткое значение и пояснение, что его меняет. */
export interface SceneStat {
  label: string;
  value: string;
  note: string;
}

/** Сводка кандидата — только факты из базы, без оценок и прогнозов (F13: вероятность приглашения не считаем). */
export function candidateStats(f: { confirmed: number; category: { specialization: string; grade: string } | null; vacancies: number; mine: number; invitations: number }): SceneStat[] {
  const cat = f.category;
  return [
    { label: 'Навыков подтверждено', value: String(f.confirmed), note: f.confirmed ? 'видны работодателям в карточке' : 'пришли резюме или ссылку' },
    { label: 'Категория', value: cat ? `${SPEC_LABEL[cat.specialization as keyof typeof SPEC_LABEL] ?? cat.specialization} · ${gradeLabel(cat.grade)}` : '—', note: cat ? 'по тесту платформы' : 'даёт только тест' },
    { label: 'Вакансий на платформе', value: String(f.vacancies), note: cat ? `в твоей категории: ${f.mine}` : 'по всем направлениям' },
    { label: 'Приглашений', value: String(f.invitations), note: f.invitations ? 'в разделе «Приглашения»' : 'компании пишут сами' },
  ];
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
  /** Кандидату: сводка на сцене рядом с головой (владелец 11.10: «часть свободного места метриками залить»). */
  stats?: SceneStat[];
  /** Кандидату: следующий незаполненный вопрос анкеты — открывается в чате кнопкой «дополнить». */
  fill?: { stepId: string; label: string };
  /** Идёт извлечение фактов из последней реплики — колонка перечитает данные ещё раз. */
  memoryPending?: boolean;
  /** Лимит пунктов памяти (chat + user). */
  memoryLimit?: number;
  /** Кандидату — активные потребности компаний по категориям; работодателю — кандидаты с категорией по тесту. */
  market?: { total: number; rows: MarketRow[] };
  /** Загруженное кандидатом; у работодателя null (блок не показывается). */
  docs: AsideDoc[] | null;
  hint: { title: string; text: string };
  /** Кандидату — как работает его консультант (скиллы и свои инструкции); у работодателя нет. */
  instructions?: ConsultantSettingsData;
  /** Идёт знакомство: колонка — только «Заполнение профиля» и «Что я о тебе знаю», остального нет. */
  onboarding?: { done: number; total: number; current: string | null };
}

/**
 * Знакомство не завершено (до итога) — и когда вопрос открыт, и когда необязательные вопросы ждут в чате
 * (пауза `later`). Владелец 11.10: «надо минимализм держать весь онбординг… две карточки только сделать и
 * все справа в нижней части и больше ничего».
 */
export const onboardingMode = (view: OnboardingView | undefined): boolean => !!view && !view.onboarded;

/** Колонка на время знакомства: прогресс анкеты и ответы (мой вид / для компании), без рынка, файлов и метрик. */
export function onboardingAside(role: SceneAsideData['role'], view: OnboardingView, known: Pick<SceneAsideData, 'known' | 'memoryPending' | 'memoryLimit'>): SceneAsideData {
  const current = view.current.kind === 'summary' ? null : view.current.label;
  // Пауза: следующий вопрос — пункт «+ дополнить» в «Что я о тебе знаю», как в полной колонке.
  const fill = view.later && current ? { stepId: view.current.id, label: current } : undefined;
  return { role, steps: [], ...known, docs: null, hint: { title: '', text: '' }, onboarding: { done: view.progress.done, total: view.progress.total, current: view.later ? null : current }, ...(fill ? { fill } : {}) };
}

/** Аккаунт без роли (первый вопрос знакомства): та же урезанная колонка, только из ответов знакомства. */
export function guestAside(view: OnboardingView): SceneAsideData {
  return onboardingAside(view.role === 'employer' ? 'employer' : 'candidate', view, { known: knownFacts(view) });
}

/** final — завершающий шаг пути (lane hired: «Нанят»): может быть «готов», тогда весь путь пройден. */
type StepDraft = Omit<JourneyStep, 'state'> & { done: boolean; final?: boolean };

/**
 * Первый незавершённый шаг — «сейчас», до него — «готово», после — «дальше».
 * Последний шаг («приглашения») не бывает «готов»: если все предыдущие пройдены, он «сейчас».
 */
export function markStates(drafts: StepDraft[]): JourneyStep[] {
  const found = drafts.findIndex((d, i) => !d.done || (i === drafts.length - 1 && !d.final));
  const nowIdx = found === -1 ? drafts.length : found;
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
  const editable = (stepId: string) => view.history.some((h) => h.stepId === stepId && h.editable);
  const fact = (stepId: string, label: string, value: string): KnownFact => ({ id: `step:${stepId}`, source: 'onboarding', stepId, label, value, editable: editable(stepId) });
  if (view.summary) return view.summary.items.filter((i) => !HIDDEN_FACTS.has(i.stepId)).map((i) => fact(i.stepId, i.label, i.value));
  return view.history
    .filter((h) => h.answer !== null && h.label && !HIDDEN_FACTS.has(h.stepId))
    .map((h) => fact(h.stepId, h.label as string, h.answer as string));
}

/** Пункты памяти (ConsultantMemory) в виде KnownFact. */
export function memoryFacts(items: MemoryItem[]): KnownFact[] {
  return items.map((m) => ({ id: m.id, source: m.source, label: '', value: m.text, editable: true, createdAt: m.createdAt }));
}

/** Знакомство + память; сбой чтения памяти — только знакомство (колонка не ломается). */
async function knownWithMemory(owner: MemoryOwner, view: OnboardingView | undefined): Promise<Pick<SceneAsideData, 'known' | 'memoryPending' | 'memoryLimit'>> {
  const memory = await listMemory(owner).catch((err: unknown) => {
    console.warn('[aside] memory failed', err instanceof Error ? err.message : err);
    return [] as MemoryItem[];
  });
  return { known: [...knownFacts(view), ...memoryFacts(memory)], memoryPending: memoryPending(owner), memoryLimit: MEMORY_LIMIT };
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
  /** Порядок пути — решение владельца 11.10 (ADR 0008), считает agent/journey.ts. Не заданы — шаг не пройден. */
  call?: boolean;
  project?: boolean;
  aiDefense?: boolean;
  /** Принятых приглашений: ответ дан, дальше живая защита. */
  accepted?: number;
  /** lane hired: компания отметила найм по принятому приглашению — финальный этап пути. */
  hired?: { company: string } | null;
}

/** Знакомство → тест → квалифицирующий созвон → проект → ИИ-защита → приглашения → живая защита → нанят. */
export function candidateSteps(f: CandidateFacts): JourneyStep[] {
  const hired = f.hired ?? null;
  const answered = hired !== null || (f.accepted ?? 0) > 0;
  return markStates([
    { id: 'intro', label: 'Знакомство', short: 'Знакомство', note: f.introNote, href: '/consultant', done: f.intro },
    {
      id: 'test',
      label: 'Тест на грейд',
      short: 'Тест',
      note: f.category ? `${SPEC[f.category.specialization] ?? f.category.specialization} · ${GRADE[f.category.grade] ?? f.category.grade}` : 'категорию даёт только тест',
      href: '/test',
      done: f.category !== null,
    },
    {
      id: 'call',
      label: 'Квалифицирующий созвон',
      short: 'Созвон',
      note: f.call ? 'пройден, карта глубины готова' : f.confirmed > 0 ? 'кнопка «Созвониться» в консультации' : 'приложи резюме или ссылки - будет о чём поговорить',
      href: '/consultant',
      done: f.call === true,
    },
    { id: 'project', label: 'Проект из ленты', short: 'Проект', note: f.project ? 'проверен' : 'возьми проект и сдай репозиторий', href: '/projects', done: f.project === true },
    { id: 'ai_defense', label: 'ИИ-защита проекта', short: 'ИИ-защита', note: f.aiDefense ? 'пройдена' : 'скоро', href: '/projects', done: f.aiDefense === true },
    {
      id: 'invites',
      label: 'Приглашения',
      short: 'Приглашения',
      note: f.invitations > 0 ? invitesWord(f.invitations) : 'работодатели находят тебя сами',
      href: '/invitations',
      done: answered,
    },
    { id: 'live_defense', label: 'Живая защита', short: 'Защита', note: hired ? 'пройдена' : answered ? 'работодатель назначит время' : 'после принятого приглашения', href: '/invitations', done: hired !== null },
    ...(hired ? [{ id: 'hired', label: `Нанят в ${hired.company}`, short: 'Нанят', note: 'компания отметила найм', href: '/invitations', done: true, final: true }] : []),
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

// Кандидату знакомство — вопросы в чате, «паузы» нет (решение владельца 11.10); у работодателя пауза осталась.
const introNote = (view: OnboardingView | undefined, done: boolean, paused = true) =>
  done || !view ? 'пройдено' : `${view.progress.done} из ${view.progress.total}${paused && view.later ? ', на паузе' : ''}`;

/** Подсказка по текущему шагу. Тексты — из существующих описаний экранов и шагов знакомства. */
export function hintFor(role: 'candidate' | 'employer', steps: JourneyStep[], view: OnboardingView | undefined): { title: string; text: string } {
  const now = steps.find((s) => s.state === 'now');
  if (now?.id === 'intro' && view) {
    const c = view.current;
    return { title: c.label || 'Знакомство', text: c.sub ?? c.question };
  }
  if (role === 'candidate') {
    if (now?.id === 'test') return { title: 'Тест на грейд', text: 'Специализацию и грейд определяет только тест, а не резюме и не ответы в чате.' };
    if (now?.id === 'call') return { title: 'Квалифицирующий созвон', text: 'Короткий голосовой разговор по темам резюме: итог - карта глубины, работодатель видит её до приглашения. Нужны утверждения: приложи резюме или ссылки, подтверди карточки.' };
    if (now?.id === 'project') return { title: 'Проект из ленты', text: 'Возьми проект на странице «Проекты», сдай репозиторий и дождись проверки: результат увидит работодатель.' };
    if (now?.id === 'ai_defense') return { title: 'ИИ-защита проекта', text: 'Скоро: ИИ задаст вопросы по коду и коммитам, работодатель до приглашения увидит только вердикт под псевдонимом.' };
    if (now?.id === 'live_defense') return { title: 'Живая защита', text: 'Приглашение принято: работодатель предложит слоты, ты выберешь время в разделе «Приглашения». Защита идёт с записью.' };
    const hired = steps.find((s) => s.id === 'hired');
    if (!now && hired) return { title: hired.label, text: 'Путь пройден: компания отметила найм. Профиль больше не показывается в поиске других работодателей.' };
    return { title: 'Приглашения', text: 'Компании сами находят тебя по подтверждённым карточкам и пишут вилку и способ связи - всё это видно до того, как ты ответишь.' };
  }
  if (now?.id === 'needs') return { title: 'Потребность', text: 'Опиши, кто нужен, - и платформа подберёт кандидатов с обоснованием.' };
  return { title: now?.label ?? 'Подбор', text: 'Ищи по подтверждённым карточкам и отправляй приглашение с вилкой зарплаты; контакты кандидата открываются после его согласия.' };
}

/** Документы кандидата: файлы (Upload) и подключённые ссылки (Source) со статусом разбора. */
export async function loadCandidateDocs(candidateId: string): Promise<AsideDoc[]> {
  const [uploads, sources, claims] = await Promise.all([
    prisma.upload.findMany({ where: { candidateId }, select: { id: true, filename: true, extracted: true, storageKey: true }, orderBy: { createdAt: 'desc' }, take: 20 }),
    prisma.source.findMany({ where: { candidateId, kind: { in: ['url', 'github', 'codeforces', 'stackoverflow'] } }, select: { id: true, origin: true, claims: { where: { status: { not: 'rejected' } }, select: { id: true } } }, orderBy: { fetchedAt: 'desc' }, take: 10 }),
    prisma.claim.findMany({ where: { candidateId, status: { not: 'rejected' } }, select: { sourceRef: true } }),
  ]);
  const status = (n: number) => (n > 0 ? `разобран, ${claimsWord(n)}` : 'разобран, утверждений нет');
  const files = uploads.map((u): AsideDoc => {
    const n = claims.filter((c) => c.sourceRef.startsWith(`${u.filename}#`)).length;
    return { id: u.id, name: u.filename, kind: 'file', status: u.extracted ? status(n) : 'разбирается', hasFile: Boolean(u.storageKey) };
  });
  const links = sources.map((s): AsideDoc => ({ id: s.id, name: s.origin.replace(/^https?:\/\//, ''), kind: 'link', status: status(s.claims.length) }));
  return [...files, ...links];
}

export async function loadCandidateAside(candidateId: string, view: OnboardingView | undefined): Promise<SceneAsideData> {
  if (view && onboardingMode(view)) return onboardingAside('candidate', view, await knownWithMemory({ candidateId }, view));
  const [profileClaims, category, invitations, docs, vacancies, known, instructions, hiredInv, journey] = await Promise.all([
    prisma.claim.count({ where: { candidateId, status: { in: ['confirmed', 'edited'] } } }),
    prisma.candidateCategory.findFirst({ where: { candidateId }, orderBy: { confirmedAt: 'desc' }, select: { specialization: true, grade: true } }),
    prisma.invitation.count({ where: { candidateId } }),
    loadCandidateDocs(candidateId),
    prisma.vacancy.findMany({ where: { archivedAt: null }, select: { specialization: true, grade: true } }),
    knownWithMemory({ candidateId }, view),
    loadConsultantSettings(candidateId),
    prisma.invitation.findFirst({ where: { candidateId, status: 'hired' }, orderBy: { hiredAt: 'desc' }, select: { company: { select: { name: true } }, vacancy: { select: { company: { select: { name: true } } } } } }),
    journeyState(candidateId),
  ]);
  const intro = introDone(view);
  const hired = hiredInv ? { company: hiredInv.company?.name ?? hiredInv.vacancy?.company.name ?? 'компанию' } : null;
  const steps = candidateSteps({ intro, introNote: introNote(view, intro, false), confirmed: profileClaims, category, invitations, hired, call: journey.steps.call, project: journey.steps.project, aiDefense: journey.steps.ai_defense, accepted: journey.counts.acceptedInvitations });
  const market = marketRows(vacancies, (spec, grade) => category?.specialization === spec && category.grade === grade);
  const mine = vacancies.filter((v) => category?.specialization === v.specialization && category.grade === v.grade).length;
  const stats = candidateStats({ confirmed: profileClaims, category, vacancies: vacancies.length, mine, invitations });
  // Следующий незаполненный вопрос анкеты — пункт «дополнить» в «Что я о тебе знаю» (только пока лента — разговор).
  const fill = view?.later && view.current.kind !== 'summary' ? { stepId: view.current.id, label: view.current.label } : undefined;
  return { role: 'candidate', steps, ...known, market, docs, hint: hintFor('candidate', steps, view), instructions, stats, ...(fill ? { fill } : {}) };
}

export async function loadEmployerAside(employerProfileId: string, view: OnboardingView | undefined): Promise<SceneAsideData> {
  if (view && onboardingMode(view)) return onboardingAside('employer', view, await knownWithMemory({ employerProfileId }, view));
  const ctx = await loadEmployerContext(employerProfileId);
  const [vacancies, invitations, categories, known] = await Promise.all([
    listVacancies(ctx.companyId),
    prisma.invitation.count({ where: { companyId: ctx.companyId } }),
    prisma.candidateCategory.findMany({ orderBy: { confirmedAt: 'desc' }, select: { candidateId: true, specialization: true, grade: true } }),
    knownWithMemory({ employerProfileId }, view),
  ]);
  const active = vacancies.filter((v) => !v.archived);
  const intro = introDone(view);
  const steps = employerSteps({ intro, introNote: introNote(view, intro), needs: active.length, invitations });
  // категория кандидата — последняя по тесту; пересдачи не считаем дважды
  const latest = new Map<string, { specialization: string; grade: string }>();
  for (const c of categories) if (!latest.has(c.candidateId)) latest.set(c.candidateId, c);
  const market = marketRows([...latest.values()], (spec, grade) => active.some((v) => v.specialization === spec && v.grade === grade));
  return { role: 'employer', steps, ...known, market, docs: null, hint: hintFor('employer', steps, view) };
}
