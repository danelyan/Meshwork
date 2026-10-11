import { COMPANION_NAME_INS } from '@/lib/persona';

import type { OnboardingView } from '../onboarding/types';

// Полоса этапов знакомства над чатом консультанта (макет Astra v2, docs/design-spec.md): пять этапов и
// «Заполнено X из N». Состояния считаются по ответам знакомства и фактам профиля; чистые функции, без БД.
// Грейд в полосе – предполагаемый: категорию даёт только тест (последний этап).

export type StageState = 'done' | 'now' | 'next';

export interface IntroStage {
  id: string;
  label: string;
  /** Строка под названием: значение этапа, «сейчас» или что на нём будет. */
  note: string;
  state: StageState;
}

export interface IntroStages {
  title: string;
  /** «Заполнено done из total». */
  done: number;
  total: number;
  items: IntroStage[];
}

export interface StageDraft {
  id: string;
  label: string;
  done: boolean;
  /** Подпись закрытого этапа; без неё – «готово». */
  doneNote?: string;
  /** Подпись этапа, до которого ещё не дошли; без неё – «дальше». */
  nextNote?: string;
}

/** Закрытые этапы – «готово» (где бы ни стояли), первый незакрытый – «сейчас», остальные – «дальше». */
export function markStages(drafts: StageDraft[]): IntroStage[] {
  const nowIdx = drafts.findIndex((d) => !d.done);
  return drafts.map((d, i) => {
    const state: StageState = d.done ? 'done' : i === nowIdx ? 'now' : 'next';
    const note = state === 'done' ? d.doneNote || 'готово' : state === 'now' ? 'сейчас' : d.nextNote || 'дальше';
    return { id: d.id, label: d.label, note, state };
  });
}

/** Ответ шага знакомства: из итога, если он показан, иначе из ленты; пропущенный шаг – null. */
export function stageAnswer(view: OnboardingView | undefined, stepId: string): string | null {
  if (!view) return null;
  const fromSummary = view.summary?.items.find((i) => i.stepId === stepId)?.value;
  if (fromSummary) return fromSummary;
  return view.history.find((h) => h.stepId === stepId && h.answer !== null)?.answer ?? null;
}

/**
 * Сохранённый ответ шага (OnboardingState.answers) – когда ленты знакомства уже нет: после итога ответы про опыт
 * лежат только там. Пустая строка, пустой список и отсутствие ключа – ответа нет.
 */
export function hasSavedAnswer(answers: unknown, stepId: string): boolean {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return false;
  const v = (answers as Record<string, unknown>)[stepId];
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== undefined;
}

export interface Progress {
  done: number;
  total: number;
}

/** Заполненность по списку «поле заполнено / нет» – для аккаунта без ленты знакомства. */
export function checklistProgress(checks: boolean[]): Progress {
  return { done: checks.filter(Boolean).length, total: checks.length };
}

export interface CandidateStageFacts {
  /** Подпись направления (ответ знакомства или Candidate.specialization). */
  specialization: string | null;
  /** Предполагаемый грейд со слов (ответ знакомства или CandidateProfile.claimedGrade). */
  claimedGrade: string | null;
  /** Есть резюме, ссылка или рассказ об опыте. */
  materials: boolean;
  /** Указаны условия: формат работы, город или зарплатные ожидания. */
  terms: boolean;
  /** Категория по тесту («Backend · Middle»); null – тест не пройден. */
  category: string | null;
  progress: Progress;
}

export function candidateStages(f: CandidateStageFacts): IntroStages {
  return {
    title: `Знакомство с ${COMPANION_NAME_INS}`,
    ...f.progress,
    items: markStages([
      { id: 'specialization', label: 'Специализация', done: f.specialization !== null, doneNote: f.specialization ?? undefined, nextNote: 'направление' },
      { id: 'grade', label: 'Грейд', done: f.claimedGrade !== null || f.category !== null, doneNote: f.claimedGrade ? `${f.claimedGrade} · со слов` : 'по тесту', nextNote: 'предполагаемый' },
      { id: 'materials', label: 'Резюме и опыт', done: f.materials, nextNote: 'файл, ссылка или рассказ' },
      { id: 'terms', label: 'Условия', done: f.terms, nextNote: 'формат и зарплата' },
      { id: 'test', label: 'Тест', done: f.category !== null, doneNote: f.category ?? undefined, nextNote: 'подтверждает грейд' },
    ]),
  };
}

export interface EmployerStageFacts {
  company: string | null;
  industry: string | null;
  contact: boolean;
  /** Активных вакансий. */
  needs: number;
  /** Отправлено приглашений. */
  invitations: number;
  /** Нет ленты знакомства – заполненность считается по этапам. */
  progress?: Progress;
}

export function employerStages(f: EmployerStageFacts): IntroStages {
  const items = markStages([
    { id: 'company', label: 'Компания', done: !!f.company, doneNote: f.company ?? undefined, nextNote: 'название' },
    { id: 'industry', label: 'Отрасль', done: !!f.industry, doneNote: f.industry ?? undefined, nextNote: 'чем занимается' },
    { id: 'contact', label: 'Контакты', done: f.contact, nextNote: 'куда ответит кандидат' },
    { id: 'need', label: 'Потребность', done: f.needs > 0, doneNote: `активных: ${f.needs}`, nextNote: 'кто нужен' },
    { id: 'selection', label: 'Подборка', done: f.invitations > 0, doneNote: `приглашений: ${f.invitations}`, nextNote: 'кандидаты с обоснованием' },
  ]);
  const progress = f.progress ?? checklistProgress(items.map((i) => i.state === 'done'));
  return { title: 'Знакомство с компанией', ...progress, items };
}
