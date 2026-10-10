import { decidePassed, evaluateDefense, scoreTotal, THRESHOLD, type EvaluationResult } from '../defense/evaluator';
import { CRITERIA, type DefenseScores, type Score } from '../defense/types';
import { AppError } from '../errors';
import type { LlmProvider } from '../llm/types';
import type { DefenseFlag, DefenseRoomVerdict, TranscriptEntry } from './types';

/**
 * Вердикт защиты проекта: слепой оценщик по рубрике A-02 (defense/evaluator.ts — тот же промпт,
 * та же проверка цитат кодом), три прогона, медиана по каждому признаку. Оценщик видит только пары
 * «вопрос → ответ кандидата»: ни кода, ни результата тестов, ни ожидаемых пунктов.
 * Слабая защита при сильном проекте — флаг работодателю, не понижение; вердикта «фейк» нет
 * (ст. 16 152-ФЗ: решение, порождающее последствия, не принимается только автоматически).
 */

export const VERDICT_RUNS = 3;
export const VERDICT_RULES = {
  /** Проект «сильный»: доля скрытых тестов не ниже. ПРЕДЛОЖЕНИЕ, калибровать на персонах лейна validation. */
  strongProjectScore: 0.8,
  /** Ответов меньше — флаг short_defense. */
  minAnswers: 3,
  /** Разброс сумм прогонов не меньше — флаг evaluator_disagreement. */
  disagreementSpread: 3,
  version: 'defense-room-v0-2026-10-10',
} as const;

/** Пары для оценщика: ответ кандидата и всё, что сказали ИИ и работодатель перед ним. */
export function transcriptTurns(transcript: TranscriptEntry[]): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  let asked: string[] = [];
  for (const e of transcript) {
    if (e.role === 'candidate') {
      if (asked.length) out.push({ question: asked.join('\n'), answer: e.text });
      else if (out.length) out[out.length - 1]!.answer += `\n${e.text}`;
      asked = [];
    } else if (e.defense?.kind !== 'closing') {
      asked.push(e.role === 'employer' ? `Работодатель: ${e.text}` : e.text);
    }
  }
  return out;
}

export function median3(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) / 2)] ?? 0;
}

export function medianScores(runs: DefenseScores[]): DefenseScores {
  return Object.fromEntries(CRITERIA.map((c) => [c, median3(runs.map((r) => r[c])) as Score])) as unknown as DefenseScores;
}

export interface FlagInput {
  passed: boolean | null;
  projectScore: number | null;
  answered: number;
  runTotals: number[];
  employerAsked: number;
  employerAnswered: number;
}

export function computeFlags(i: FlagInput): DefenseFlag[] {
  const flags: DefenseFlag[] = [];
  if (i.projectScore === null) flags.push('no_project_result');
  else if (i.projectScore >= VERDICT_RULES.strongProjectScore && i.passed === false) flags.push('strong_project_weak_defense');
  if (i.answered < VERDICT_RULES.minAnswers) flags.push('short_defense');
  if (i.runTotals.length > 1 && Math.max(...i.runTotals) - Math.min(...i.runTotals) >= VERDICT_RULES.disagreementSpread) flags.push('evaluator_disagreement');
  if (i.employerAsked > i.employerAnswered) flags.push('employer_questions_unanswered');
  return flags;
}

const FLAG_TEXT: Record<DefenseFlag, string> = {
  strong_project_weak_defense:
    'Проект прошёл автопроверку хорошо, а на защите кандидат объяснил свой код слабее порога. Это повод поговорить, а не вывод о подлинности: посмотрите транскрипт или задайте свои вопросы.',
  short_defense: 'Ответов мало - оценка неустойчива.',
  evaluator_disagreement: 'Прогоны оценщика заметно разошлись - лучше прочитать транскрипт.',
  employer_questions_unanswered: 'Не на все вопросы работодателя есть ответ - они остаются в очереди до следующего входа кандидата.',
  no_project_result: 'Результата автопроверки проекта нет - сравнить проект и защиту нельзя.',
};

export function buildSummary(v: Pick<DefenseRoomVerdict, 'total' | 'passed' | 'flags' | 'projectScore' | 'answered'>): string {
  const head =
    v.total === null
      ? 'Оценки нет: кандидат не ответил ни на один вопрос.'
      : `Защита по рубрике A-02: ${v.total} из 8 (медиана трёх прогонов оценщика) - ${v.passed ? 'понимание своего кода показано' : 'ниже порога (≥ 5, «почему так» ≥ 1, не больше одного нуля)'}.`;
  const project = v.projectScore === null ? '' : `Автопроверка проекта: ${Math.round(v.projectScore * 100)}% скрытых тестов.`;
  const flags = v.flags.map((f) => `• ${FLAG_TEXT[f]}`);
  const tail = 'Защита проверяет понимание кода сейчас, а не авторство; автоматического решения о кандидате платформа не принимает.';
  return [head, project, ...flags, tail].filter(Boolean).join('\n');
}

export interface VerdictInput {
  projectTitle: string;
  transcript: TranscriptEntry[];
  projectScore: number | null;
  employerAsked: number;
  employerAnswered: number;
}

export async function evaluateDefenseRoom(input: VerdictInput, llm: LlmProvider, runs = VERDICT_RUNS): Promise<DefenseRoomVerdict> {
  const turns = transcriptTurns(input.transcript);
  const now = new Date().toISOString();
  if (turns.length === 0) {
    const flags = computeFlags({ passed: null, projectScore: input.projectScore, answered: 0, runTotals: [], employerAsked: input.employerAsked, employerAnswered: input.employerAnswered });
    const base = { total: null, passed: null, flags, projectScore: input.projectScore, answered: 0 };
    return {
      ...base,
      scores: null,
      runs: [],
      summary: buildSummary(base),
      quotes: [],
      employerQuestions: { asked: input.employerAsked, answered: input.employerAnswered },
      thresholdVersion: `${THRESHOLD.version}+${VERDICT_RULES.version}`,
      evaluatedAt: now,
    };
  }
  const evalInput = {
    claimStatement: `Кандидат защищает свой проект «${input.projectTitle}»: объясняет устройство кода, решения и их цену, отвечает на вопросы работодателя.`,
    catalogStatement: 'Понимает собственный код проекта: что он делает, почему так устроен, что сломается при изменении условий.',
    turns,
    purpose: 'call_evaluator' as const,
  };
  const settled = await Promise.allSettled(Array.from({ length: runs }, () => evaluateDefense(evalInput, llm)));
  const ok = settled.filter((s): s is PromiseFulfilledResult<EvaluationResult> => s.status === 'fulfilled').map((s) => s.value);
  if (ok.length === 0) {
    throw new AppError('llm_unavailable', 'Оценщик сейчас недоступен. Транскрипт сохранён - повтори завершение, чтобы получить оценку.', 503);
  }
  const scores = medianScores(ok.map((r) => r.scores));
  const total = scoreTotal(scores);
  const passed = decidePassed(scores);
  const runTotals = ok.map((r) => scoreTotal(r.scores));
  // Цитаты — из прогона, чья сумма ближе всего к медиане.
  const closest = ok.reduce((best, r) => (Math.abs(scoreTotal(r.scores) - total) < Math.abs(scoreTotal(best.scores) - total) ? r : best), ok[0]!);
  const flags = computeFlags({
    passed,
    projectScore: input.projectScore,
    answered: turns.length,
    runTotals,
    employerAsked: input.employerAsked,
    employerAnswered: input.employerAnswered,
  });
  const base = { total, passed, flags, projectScore: input.projectScore, answered: turns.length };
  return {
    ...base,
    scores,
    runs: runTotals,
    summary: buildSummary(base),
    quotes: closest.criteria.filter((c) => c.quoteValid).map((c) => c.quote),
    employerQuestions: { asked: input.employerAsked, answered: input.employerAnswered },
    thresholdVersion: `${THRESHOLD.version}+${VERDICT_RULES.version}`,
    evaluatedAt: now,
  };
}
