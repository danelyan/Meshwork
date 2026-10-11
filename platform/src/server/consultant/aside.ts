import { SPEC_LABEL } from '@/lib/directions';
import { gradeLabel } from '@/lib/grades';
import { prisma } from '../db';
import { journeyState, type JourneyStep as JourneyKey } from '../agent/journey';
import { listVacancies, loadEmployerContext } from '../employer';
import { liveDefenseViews } from '../live-defense/service';
import { cooldownReadiness } from '../call/readiness';
import { retakeCooldown } from '../test/service';
import { formatMsk } from '@/lib/msk';
import { type LiveStepInfo, liveStepCopy, pickLive } from '@/lib/live-step';
import type { OnboardingView } from '../onboarding/types';
import { listMemory, MEMORY_LIMIT, type MemoryItem, type MemoryOwner, memoryPending } from './memory';

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
  /** Для шага «дальше»: что сделать сначала (подсказка при наведении); у «готово» и «сейчас» нет. */
  locked?: string;
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

/** Сводка кандидата — только факты из базы, без оценок и прогнозов (F13: вероятность приглашения не считаем). Две плитки (решение владельца 12.10). */
export function candidateStats(f: { confirmed: number; category: { specialization: string; grade: string } | null }): SceneStat[] {
  const cat = f.category;
  return [
    { label: 'Навыков подтверждено', value: String(f.confirmed), note: f.confirmed ? 'видны работодателям в карточке' : 'пришли резюме или ссылку' },
    { label: 'Категория', value: cat ? `${SPEC_LABEL[cat.specialization as keyof typeof SPEC_LABEL] ?? cat.specialization} · ${gradeLabel(cat.grade)}` : '—', note: cat ? 'по тесту платформы' : 'даёт только тест' },
  ];
}

/** Строка «рынка»: категория (специализация × грейд) и сколько в ней; mine — совпадает с категорией/потребностью пользователя. */
export interface MarketRow {
  key: string;
  label: string;
  count: number;
  mine: boolean;
}

/** Данные блока под текущий шаг пути кандидата. Нет данных — блок не рисуется. */
/**
 * Что мешает сделать шаг прямо сейчас (другое правило платформы): путь показывает блокер и ведёт к его снятию,
 * а не к кнопке, которая ответит ошибкой. href — куда идти; action — действие кнопкой в колонке.
 */
export interface StepBlocker {
  text: string;
  href?: string;
  action?: 'grant_ai_assessment';
}

/** Без согласия на оценку ИИ тест, созвон и защиты отвечают 409 (consent/service.ts, assertAiAssessmentConsent). */
export const AI_CONSENT_BLOCKER: StepBlocker = { text: 'Сначала — согласие на оценку ИИ: без него тест, созвон и защита не запустятся', action: 'grant_ai_assessment' };
/** Скрытый профиль (флаг или нет согласия employer_visibility) в поиске работодателей не показывается. */
export const HIDDEN_BLOCKER: StepBlocker = { text: 'Профиль скрыт — компании тебя не видят', href: '/settings' };

const AI_CONSENT_KEYS: readonly JourneyKey[] = ['test', 'call', 'project', 'ai_defense', 'live_defense'];
/** id шага пути колонки по шагу journeyState. */
const ASIDE_ID: Partial<Record<JourneyKey, string>> = { onboarding: 'intro', test: 'test', call: 'call', project: 'project', ai_defense: 'ai_defense', waiting: 'invites', invitations: 'invites', live_defense: 'live_defense', hired: 'hired' };

/** Блокер текущего шага по фактам: согласие на ИИ — для оцениваемых шагов, скрытость — для приглашений. */
export function stepBlocker(step: JourneyKey, f: { aiConsent: boolean; hidden: boolean }): StepBlocker | undefined {
  if (!f.aiConsent && AI_CONSENT_KEYS.includes(step)) return AI_CONSENT_BLOCKER;
  if (f.hidden && (step === 'waiting' || step === 'invitations')) return HIDDEN_BLOCKER;
  return undefined;
}

/** Нота шага в пути отражает блокер: скрытый профиль — у «Приглашений», нет согласия — у текущего оцениваемого шага. */
export function blockerNotes(steps: JourneyStep[], step: JourneyKey, f: { aiConsent: boolean; hidden: boolean }): JourneyStep[] {
  const nowId = !f.aiConsent && AI_CONSENT_KEYS.includes(step) ? ASIDE_ID[step] : undefined;
  return steps.map((s) => {
    if (s.id === nowId && s.state !== 'done') return { ...s, note: 'сначала - согласие на оценку ИИ' };
    if (f.hidden && s.id === 'invites' && s.state !== 'done') return { ...s, note: 'профиль скрыт' };
    return s;
  });
}

/** Кулдаун шага: блокер без кнопки и короткая нота в пути. */
export interface CooldownCopy {
  stepId: 'test' | 'call';
  blocker: StepBlocker;
  note: string;
}

/** Тест: пересдача того же грейда закрыта интервалом (retake_too_soon); другой грейд открыт — так и пишем. */
export function retakeCopy(c: { grade: string; nextAllowedAt: Date; demo: boolean }, now: Date = new Date()): CooldownCopy {
  const ms = Math.max(0, c.nextAllowedAt.getTime() - now.getTime());
  const wait = c.demo ? `${Math.max(1, Math.ceil(ms / 60_000))} мин` : `${Math.max(1, Math.ceil(ms / 86_400_000))} дн.`;
  const g = GRADE[c.grade] ?? c.grade;
  return {
    stepId: 'test',
    note: `пересдача ${g} через ${wait}`,
    blocker: { text: `Пересдать ${g} можно через ${wait} (с ${formatMsk(c.nextAllowedAt)}). Другой грейд можно сдать уже сейчас.` },
  };
}

/** Созвон: пауза после завершённого созвона (call/readiness.ts, cooldownText «Повторный созвон - через N ч»). */
export function callCooldownCopy(reason: string): CooldownCopy {
  return { stepId: 'call', note: reason.replace(/^Повторный созвон - через/, 'повторный созвон через'), blocker: { text: reason } };
}

async function loadCooldown(candidateId: string, step: JourneyKey, hasCategory: boolean): Promise<CooldownCopy | undefined> {
  if (step === 'test' && !hasCategory) {
    const c = await retakeCooldown(candidateId);
    return c ? retakeCopy(c) : undefined;
  }
  if (step === 'call') {
    const r = await cooldownReadiness(candidateId, 'qualifying');
    return !r.ready && r.reason ? callCooldownCopy(r.reason) : undefined;
  }
  return undefined;
}

/** Нота шага с кулдауном в пути. */
export function cooldownNote(steps: JourneyStep[], c: CooldownCopy | undefined): JourneyStep[] {
  if (!c) return steps;
  return steps.map((s) => (s.id === c.stepId && s.state !== 'done' ? { ...s, note: c.note } : s));
}

export interface StepBlock {
  step: JourneyKey;
  /** Что мешает шагу сейчас; карточка шага показывает его вместо главной кнопки. */
  blocker?: StepBlocker;
  /** waiting / invitations / live_defense: счётчики приглашений. */
  invitations?: { pending: number; accepted: number; total: number };
  /** project / ai_defense: сдача (последняя; для ИИ-защиты — последняя проверенная); null — сдач ещё нет. */
  project?: { taskId: string; title: string; status: 'submitted' | 'running' | 'checked' | 'failed' } | null;
  /** hired: компания, отметившая найм. */
  hired?: { company: string } | null;
  /** live_defense: подстатус живой защиты по принятому приглашению (нет записи — 'none'). */
  live?: LiveStepInfo;
  /** project: приглашение принято, а проверенного проекта нет — компания ждёт проект, без него защиту не назначить. */
  forLive?: boolean;
  /**
   * test: спрос в направлении кандидата (из знакомства) - одна строка вместо таблицы по всем направлениям (владелец 11.10:
   * «какой смысл … если у пользователя и так один определённый стек»). Направление не выбрано — таблица market помогает выбрать.
   */
  demand?: { direction: string; total: number; detail: string };
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
  /** Кандидату: блок под текущий шаг пути (journeyState.nextStep); у работодателя нет. */
  stepBlock?: StepBlock;
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
type StepDraft = Omit<JourneyStep, 'state'> & { done: boolean; final?: boolean; /** Своё условие вместо цепочки предыдущих шагов. */ lockedNote?: string };

/**
 * Первый незавершённый шаг — «сейчас», до него — «готово», после — «дальше».
 * Последний шаг («приглашения») не бывает «готов»: если все предыдущие пройдены, он «сейчас».
 */
export function markStates(drafts: StepDraft[]): JourneyStep[] {
  const found = drafts.findIndex((d, i) => !d.done || (i === drafts.length - 1 && !d.final));
  const nowIdx = found === -1 ? drafts.length : found;
  return drafts.map((d, i) => {
    const state: StepState = i < nowIdx ? 'done' : i === nowIdx ? 'now' : 'next';
    const before = drafts.slice(nowIdx, i).filter((x) => !x.done).map((x) => x.label);
    const locked = d.lockedNote ?? (before.length ? `Сначала: ${before.join(' → ')}` : undefined);
    return { id: d.id, label: d.label, short: d.short, note: d.note, href: d.href, state, ...(state === 'next' && locked ? { locked } : {}) };
  });
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
/** Шаги вне порядка (приглашение, живая защита, найм) приоритетнее по journeyState.nextStep: «сейчас» - у них, чтобы путь и блок шага показывали одно. */
const PRIORITY_STEP: Partial<Record<string, string>> = { invitations: 'invites', live_defense: 'live_defense', hired: 'hired' };
/** liveWaitsProject: приглашение принято, проекта нет — «сейчас» у проекта (без него компания не назначит защиту). */
export function promoteNow(steps: JourneyStep[], nextStep: string, liveWaitsProject = false): JourneyStep[] {
  const id = PRIORITY_STEP[nextStep] ?? (nextStep === 'project' && liveWaitsProject ? 'project' : undefined);
  if (!id || !steps.some((s) => s.id === id)) return steps;
  return steps.map((s) => (s.id === id ? { ...s, state: 'now', locked: undefined } : s.state === 'now' ? { ...s, state: 'next' } : s));
}

export function candidateSteps(f: CandidateFacts): JourneyStep[] {
  const hired = f.hired ?? null;
  const answered = hired !== null || (f.accepted ?? 0) > 0;
  return markStates([
    { id: 'intro', label: 'Знакомство', short: 'Знакомство', note: f.introNote, href: '/consultant', done: f.intro },
    {
      id: 'test',
      label: 'Тест на грейд',
      short: 'Тест',
      note: f.category ? `${SPEC[f.category.specialization] ?? f.category.specialization} · ${GRADE[f.category.grade] ?? f.category.grade}` : 'определит специализацию и грейд',
      href: '/test',
      done: f.category !== null,
    },
    {
      id: 'call',
      label: 'Созвон с ИИ',
      short: 'Созвон',
      note: f.call ? 'пройден, карта глубины готова' : f.confirmed > 0 ? 'кнопка «Созвониться» в консультации' : 'приложи резюме или ссылки - будет о чём поговорить',
      href: '/consultant',
      done: f.call === true,
    },
    { id: 'project', label: 'Проект из ленты', short: 'Проект', note: f.project ? 'проверен' : 'возьми проект и сдай репозиторий', href: '/projects', done: f.project === true },
    { id: 'ai_defense', label: 'ИИ-защита проекта', short: 'ИИ-защита', note: f.aiDefense ? 'пройдена' : 'после проверки проекта', href: '/projects', done: f.aiDefense === true },
    {
      id: 'invites',
      label: 'Приглашения',
      short: 'Приглашения',
      note: f.invitations > 0 ? invitesWord(f.invitations) : 'работодатели находят тебя сами',
      href: '/invitations',
      done: answered,
      lockedNote: 'Компании находят тебя сами после теста; проект и ИИ-защита повышают шансы на приглашение',
    },
    { id: 'live_defense', label: 'Живая защита', short: 'Защита', note: hired ? 'пройдена' : answered ? (f.project === true ? 'работодатель назначит время' : 'после сданного проекта компания предложит слоты') : 'после принятого приглашения', href: '/invitations', done: hired !== null, lockedNote: 'Сначала: принять приглашение компании - тогда она предложит время защиты' },
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
const introNote = (view: OnboardingView | undefined, done: boolean, paused = true, answers = 1) =>
  // Пройдено без единого ответа (аккаунт без ленты, пропущенные вопросы): говорим это прямо, а не «пройдено» рядом с «Пока ничего».
  done || !view ? (answers > 0 ? 'пройдено' : 'без ответов - расскажи о себе в чате') : `${view.progress.done} из ${view.progress.total}${paused && view.later ? ', на паузе' : ''}`;

/** Подсказка по текущему шагу. Тексты — из существующих описаний экранов и шагов знакомства. */
export function hintFor(role: 'candidate' | 'employer', steps: JourneyStep[], view: OnboardingView | undefined): { title: string; text: string } {
  const now = steps.find((s) => s.state === 'now');
  if (now?.id === 'intro' && view) {
    const c = view.current;
    return { title: c.label || 'Знакомство', text: c.sub ?? c.question };
  }
  if (role === 'candidate') {
    if (now?.id === 'test') return { title: 'Тест на грейд', text: 'Специализацию и грейд определяет только тест, а не резюме и не ответы в чате.' };
    if (now?.id === 'call') return { title: 'Созвон с ИИ', text: 'Короткий голосовой разговор по темам резюме: итог - карта глубины, работодатель видит её до приглашения. Нужны утверждения: приложи резюме или ссылки, подтверди карточки.' };
    if (now?.id === 'project') return { title: 'Проект из ленты', text: 'Возьми проект на странице «Проекты», сдай репозиторий и дождись проверки: результат увидит работодатель.' };
    if (now?.id === 'ai_defense') return { title: 'ИИ-защита проекта', text: 'ИИ задаст вопросы по коду и коммитам, работодатель до приглашения увидит только вердикт под псевдонимом.' };
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
    prisma.source.findMany({ where: { candidateId, kind: { in: ['url', 'github', 'codeforces', 'stackoverflow'] } }, select: { id: true, kind: true, origin: true }, orderBy: { fetchedAt: 'desc' }, take: 10 }),
    prisma.claim.findMany({ where: { candidateId, status: { not: 'rejected' } }, select: { sourceRef: true } }),
  ]);
  const status = (n: number) => (n > 0 ? `разобран, ${claimsWord(n)}` : 'разобран, утверждений нет');
  const files = uploads.map((u): AsideDoc => {
    const n = claims.filter((c) => c.sourceRef.startsWith(`${u.filename}#`)).length;
    return { id: u.id, name: u.filename, kind: 'file', status: u.extracted ? status(n) : 'разбирается', hasFile: Boolean(u.storageKey) };
  });
  // Как у файлов — по sourceRef: связь Claim.sourceId конвейер не заполняет. Строки источника — `origin#…`,
  // у GitHub ещё и `github:логин/репозиторий#…` (collector/github.ts).
  const fromSource = (s: { kind: string; origin: string }, ref: string) => ref.startsWith(`${s.origin}#`) || (s.kind === 'github' && ref.startsWith(`${s.origin}/`));
  const links = sources.map((s): AsideDoc => ({ id: s.id, name: s.origin.replace(/^https?:\/\//, ''), kind: 'link', status: status(claims.filter((c) => fromSource(s, c.sourceRef)).length) }));
  return [...files, ...links];
}

/** Последние сдачи проектов: заголовок задания берём из specJson.title. */
async function loadLatestSubmissions(candidateId: string) {
  const rows = await prisma.projectSubmission.findMany({ where: { candidateId }, orderBy: { submittedAt: 'desc' }, take: 10, select: { projectTaskId: true, status: true, projectTask: { select: { specJson: true } } } });
  const view = (r: (typeof rows)[number]) => {
    const title = (r.projectTask.specJson as { title?: unknown } | null)?.title;
    return { taskId: r.projectTaskId, title: typeof title === 'string' && title ? title : 'Проект из ленты', status: r.status };
  };
  const latest = rows[0];
  const checked = rows.find((r) => r.status === 'checked');
  return { latest: latest ? view(latest) : null, checked: checked ? view(checked) : null };
}

/** Спрос в направлении кандидата: «4 вакансии · Junior 2 · Middle 2». Вакансий в направлении нет — undefined (строка не рисуется). */
export function demandFor(vacancies: { specialization: string; grade: string }[], spec: string | null | undefined): StepBlock['demand'] {
  if (!spec) return undefined;
  const { total, rows } = marketRows(vacancies.filter((v) => v.specialization === spec), () => false);
  if (total === 0) return undefined;
  return { direction: SPEC[spec] ?? spec, total, detail: rows.map((r) => `${r.label.replace(/^.* · /, '')} ${r.count}`).join(' · ') };
}

/** Живая защита по принятым приглашениям: подстатус, время (МСК — при показе), компания. */
async function loadLive(candidateId: string): Promise<LiveStepInfo> {
  const accepted = await prisma.invitation.findMany({
    where: { candidateId, status: 'accepted' },
    select: { id: true, company: { select: { name: true } }, vacancy: { select: { company: { select: { name: true } } } } },
  });
  const views = await liveDefenseViews(accepted.map((i) => i.id), 'candidate');
  const items = accepted.map((i): LiveStepInfo => {
    const v = views.get(i.id);
    const company = i.company?.name ?? i.vacancy?.company.name;
    return {
      status: v?.status ?? 'none',
      ...(company ? { company } : {}),
      ...(v?.status === 'scheduled' && v.scheduled ? { scheduledAt: v.scheduled.startsAt, ...(v.scheduled.roomOpen && v.scheduled.roomHref ? { roomHref: v.scheduled.roomHref } : {}) } : {}),
    };
  });
  return pickLive(items) ?? { status: 'none' };
}

/** Нота шага «Живая защита» в пути — по подстатусу (то же, что в карточке, коротко). */
export function liveNote(steps: JourneyStep[], live: LiveStepInfo | undefined): JourneyStep[] {
  if (!live) return steps;
  const note = liveStepCopy(live).note;
  return steps.map((s) => (s.id === 'live_defense' && s.state !== 'done' ? { ...s, note } : s));
}

/** Блок под текущий шаг: что нужно для отрисовки; проект — только там, где он нужен. */
async function loadStepBlock(candidateId: string, journey: Awaited<ReturnType<typeof journeyState>>, invitations: number, demand?: StepBlock['demand']): Promise<StepBlock> {
  const step = journey.nextStep;
  if (step === 'test') return demand ? { step, demand } : { step };
  if (step === 'project' || step === 'ai_defense') {
    const subs = await loadLatestSubmissions(candidateId);
    const forLive = step === 'project' && journey.counts.acceptedInvitations > 0;
    return { step, project: step === 'project' ? subs.latest : subs.checked ?? subs.latest, ...(forLive ? { forLive } : {}) };
  }
  if (step === 'live_defense') return { step, invitations: { pending: journey.counts.pendingInvitations, accepted: journey.counts.acceptedInvitations, total: invitations }, live: await loadLive(candidateId) };
  if (step === 'waiting' || step === 'invitations') return { step, invitations: { pending: journey.counts.pendingInvitations, accepted: journey.counts.acceptedInvitations, total: invitations } };
  if (step === 'hired') return { step, hired: journey.hired ? { company: journey.hired.company } : null };
  return { step };
}

export async function loadCandidateAside(candidateId: string, view: OnboardingView | undefined): Promise<SceneAsideData> {
  if (view && onboardingMode(view)) return onboardingAside('candidate', view, await knownWithMemory({ candidateId }, view));
  const [profileClaims, category, invitations, hiredInv, known, journey, cand] = await Promise.all([
    prisma.claim.count({ where: { candidateId, status: { in: ['confirmed', 'edited'] } } }),
    prisma.candidateCategory.findFirst({ where: { candidateId }, orderBy: { confirmedAt: 'desc' }, select: { specialization: true, grade: true } }),
    prisma.invitation.count({ where: { candidateId } }),
    prisma.invitation.findFirst({ where: { candidateId, status: 'hired' }, orderBy: { hiredAt: 'desc' }, select: { company: { select: { name: true } }, vacancy: { select: { company: { select: { name: true } } } } } }),
    knownWithMemory({ candidateId }, view),
    journeyState(candidateId),
    prisma.candidate.findUnique({ where: { id: candidateId }, select: { specialization: true } }),
  ]);
  const step = journey.nextStep;
  // Блоки шага: файлы — на знакомстве, спрос компаний — на тесте (строка по направлению кандидата; таблица по всем — только
  // пока направление не выбрано); остальное — в stepBlock.
  const [docs, vacancies] = await Promise.all([
    step === 'onboarding' ? loadCandidateDocs(candidateId) : Promise.resolve(null),
    step === 'test' ? prisma.vacancy.findMany({ where: { archivedAt: null }, select: { specialization: true, grade: true } }) : Promise.resolve(null),
  ]);
  const demand = vacancies ? demandFor(vacancies, cand?.specialization) : undefined;
  const block = await loadStepBlock(candidateId, journey, invitations, demand);
  const facts = { aiConsent: journey.aiConsent, hidden: journey.hidden };
  const cooldown = await loadCooldown(candidateId, step, journey.hasCategory);
  // Согласие на ИИ важнее кулдауна: без него шаг не запустится и после паузы.
  const blocker = stepBlocker(step, facts) ?? cooldown?.blocker;
  const stepBlock: StepBlock = blocker ? { ...block, blocker } : block;
  const intro = introDone(view);
  const hired = hiredInv ? { company: hiredInv.company?.name ?? hiredInv.vacancy?.company.name ?? 'компанию' } : null;
  const steps = blockerNotes(cooldownNote(liveNote(promoteNow(
    candidateSteps({ intro, introNote: introNote(view, intro, false, known.known?.filter((k) => k.source === 'onboarding').length ?? 0), confirmed: profileClaims, category, invitations, hired, call: journey.steps.call, project: journey.steps.project, aiDefense: journey.steps.ai_defense, accepted: journey.counts.acceptedInvitations }),
    journey.nextStep,
    journey.counts.acceptedInvitations > 0 && !journey.steps.project,
  ), stepBlock.live), cooldown), step, facts);
  const market = vacancies && !cand?.specialization ? marketRows(vacancies, () => false) : undefined;
  const stats = candidateStats({ confirmed: profileClaims, category });
  // Следующий незаполненный вопрос анкеты — пункт «дополнить» в «Что я о тебе знаю» (только пока лента — разговор).
  const fill = view?.later && view.current.kind !== 'summary' ? { stepId: view.current.id, label: view.current.label } : undefined;
  return { role: 'candidate', steps, ...known, ...(market ? { market } : {}), docs, hint: hintFor('candidate', steps, view), stepBlock, stats, ...(fill ? { fill } : {}) };
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
