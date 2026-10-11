// План ИИнтервью — чистые функции (без БД и LLM): блоки по порядку, внутри блока — маршрут по уровню как
// в созвоне (call/plan.ts). Их же использует детерминированный stub (llm/providers/stub-interview.ts) и
// запасной вопрос, когда модель не ответила.
import { routeLevel } from '../call/plan';
import type { AnswerSignal, QuestionLevel } from '../call/types';
import type { Grade } from '../../lib/grades';
import { BLOCKS, BLOCK_DEFS, type BlockId, type CompetencyDef, blockDef, gradeForLevel, levelForGrade } from './model';

/** Лимиты ИИнтервью (docs/competency-model.md § 4): 5–7 вопросов, до 9 с дополнительными по неопределённым компетенциям. */
export const INTERVIEW_LIMITS = {
  minQuestions: 5,
  maxQuestions: 7,
  hardMaxQuestions: 9,
  /** На одну компетенцию — не больше стольких вопросов (дополнительные по inconclusive не считаются). */
  maxPerCompetency: 2,
} as const;

/** Блоки с вопросами, по порядку. */
export const QUESTION_BLOCKS: readonly BlockId[] = BLOCKS.filter((b) => blockDef(b).questions.max > 0);

export interface InterviewTurn {
  question: string;
  answer: string | null;
  competencyId: string;
  block: BlockId;
  level: QuestionLevel;
  /** Дополнительный вопрос по компетенции с расхождением оценщика — в счёт блока не идёт. */
  probe?: boolean;
  /** Кандидат перебил вопрос: сколько предложений услышал и что осталось недосказанным. */
  interrupted?: { heardSentences: number; tail: string };
}

/** Компетенции каждого блока в порядке приоритета (строит context.ts: ядро подкатегории, пометки теста). */
export type BlockPlan = Record<BlockId, readonly CompetencyDef[]>;

export function emptyBlockPlan(): BlockPlan {
  return { intro: [], test: [], systems: [], team: [], summary: [] };
}

/** Сколько вопросов задано в каждом блоке (без дополнительных). */
export function blockCounts(turns: readonly InterviewTurn[]): Record<BlockId, number> {
  const out = { intro: 0, test: 0, systems: 0, team: 0, summary: 0 };
  for (const t of turns) if (!t.probe) out[t.block] += 1;
  return out;
}

/** Текущий блок — блок последнего вопроса (переход к следующему решает planInterviewNext). */
export function currentBlock(turns: readonly InterviewTurn[]): BlockId {
  const last = [...turns].reverse().find((t) => !t.probe);
  return last?.block ?? QUESTION_BLOCKS[0]!;
}

/** Блок, в котором интервью сейчас (для UI: этапы): summary — когда вопросы закончились. */
export function stageOf(turns: readonly InterviewTurn[], done: boolean): BlockId {
  return done ? 'summary' : currentBlock(turns);
}

export interface PlannedInterviewQuestion {
  block: BlockId;
  competency: CompetencyDef;
  level: QuestionLevel;
  signal: AnswerSignal | null;
  /** Вопросов достаточно: все блоки закрыты по минимуму и лимит либо исчерпан, либо продолжать нечем. */
  done: boolean;
}

/**
 * Следующий вопрос: блок → компетенция → уровень.
 * - Блок: остаёмся, пока не задан минимум; при сильном ответе и запасе до максимума — остаёмся углублять (кроме intro);
 *   иначе — следующий блок. После последнего блока — done.
 * - Компетенция: после сильного ответа на уровне < 3 и при лимите на компетенцию — та же, глубже;
 *   иначе первая ещё не спрошенная компетенция блока (все спрошены — спрошенная меньше всех).
 * - Уровень: стартовый по заявленному грейду; после слабого ответа новая компетенция стартует на уровень проще.
 */
export function planInterviewNext(args: {
  plan: BlockPlan;
  turns: readonly InterviewTurn[];
  grade: Grade | null | undefined;
  signal: AnswerSignal | null;
  maxQuestions?: number;
}): PlannedInterviewQuestion {
  const { plan, turns, grade } = args;
  const max = args.maxQuestions ?? INTERVIEW_LIMITS.maxQuestions;
  const base = levelForGrade(grade);
  const asked = turns.filter((t) => !t.probe);
  const signal = args.signal ?? 'none';
  const last = asked[asked.length - 1];
  const counts = blockCounts(turns);
  const remaining = max - asked.length;
  const done = (b: BlockId): PlannedInterviewQuestion => ({ block: 'summary', competency: pick(plan, b, asked), level: base, signal, done: true });

  let block: BlockId = currentBlock(turns);
  if (last && last.block === block) {
    const def = blockDef(block);
    const onComp = asked.filter((t) => t.competencyId === last.competencyId).length;
    // Запас: после этого вопроса должно хватить на минимумы оставшихся блоков.
    const after = QUESTION_BLOCKS.slice(QUESTION_BLOCKS.indexOf(block) + 1).reduce((s, b) => s + Math.max(0, blockDef(b).questions.min - counts[b]), 0);
    const room = counts[block] < def.questions.max && remaining - 1 >= after;
    const stay = block !== 'intro' && signal === 'strong' && room;
    if (stay && last.level < 3 && onComp < INTERVIEW_LIMITS.maxPerCompetency) {
      return { block, competency: pick(plan, block, asked, last.competencyId), level: routeLevel(last.level, 'strong'), signal, done: false };
    }
    // Углублять некуда (уровень 3 или лимит на компетенцию), а новых компетенций в блоке нет — остаться значило бы
    // задать тот же вопрос ещё раз (аудит 12.10: Senior, системный дизайн с одной компетенцией — вопрос повторён дословно).
    const fresh = plan[block].some((c) => !asked.some((t) => t.competencyId === c.id));
    if ((!stay || !fresh) && counts[block] >= def.questions.min) {
      const next = QUESTION_BLOCKS[QUESTION_BLOCKS.indexOf(block) + 1];
      if (!next) return done(block);
      block = next;
    }
  }
  if (remaining <= 0) return done(block);
  const competency = pick(plan, block, asked);
  const level = last && signal === 'weak' && last.block === block ? (Math.max(1, base - 1) as QuestionLevel) : base;
  return { block, competency, level, signal, done: false };
}

/** Компетенция блока: заданная (prefer) → первая не спрошенная → спрошенная меньше всех. */
function pick(plan: BlockPlan, block: BlockId, asked: readonly InterviewTurn[], prefer?: string): CompetencyDef {
  const list = plan[block];
  if (list.length === 0) {
    const any = BLOCK_DEFS.flatMap((b) => plan[b.id]);
    if (any.length === 0) throw new Error(`interview plan: нет компетенций для блока ${block}`);
    return any[0]!;
  }
  if (prefer) {
    const p = list.find((c) => c.id === prefer);
    if (p) return p;
  }
  const count = (id: string) => asked.filter((t) => t.competencyId === id).length;
  const fresh = list.find((c) => count(c.id) === 0);
  if (fresh) return fresh;
  return [...list].sort((a, b) => count(a.id) - count(b.id))[0]!;
}

/** Запасной вопрос по фокусу компетенции на уровне; формулировка фиксирована, тему задаёт фокус. */
export function templateInterviewQuestion(c: CompetencyDef, block: BlockId, level: QuestionLevel, first: boolean): string {
  const hello = first ? 'Привет! Это Кира, пройдём четыре коротких блока — знакомство, профильные темы, проектирование и работа в команде. ' : '';
  const focus = c.focus[gradeForLevel(level)];
  if (block === 'intro') return `${hello}Расскажи про последний проект: ${lower(focus.replace(/^Последний проект:\s*/, ''))}.`;
  if (block === 'team') return `${hello}Теперь про команду — вспомни конкретный случай из опыта. ${focus}?`;
  if (block === 'systems') return `${hello}Перейдём к проектированию. ${focus} — с чего начнёшь и где будет узкое место?`;
  // Название компетенции — в именительном падеже после тире («Про «вёрстка и стили»» было неграмотно).
  const theme = `Следующая тема — ${lower(c.title)}.`;
  if (level === 1) return `${hello}${theme} ${focus} — объясни своими словами, на примере из своей работы.`;
  if (level === 2) return `${hello}${theme} ${focus}. Как это было устроено у тебя и почему именно так?`;
  return `${hello}Копнём глубже. ${theme} ${focus}. Где этот подход перестаёт работать?`;
}

function lower(s: string): string {
  // Аббревиатуры («API и контракты», «LLM-приложения») не трогаем: было «aPI и контракты».
  if (/^[A-ZА-ЯЁ]{2}/.test(s)) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Подсказка «Уточнить вопрос» — на клиенте, без обращения к серверу и без расхода лимита: о чём именно
 * спрашивает вопрос этой компетенции на этом уровне (фокус модели). Ответом не считается и оценщику не уходит.
 */
export function clarificationHint(c: CompetencyDef, level: QuestionLevel): string {
  const what = level === 1 ? 'Достаточно объяснить своими словами и привести пример из своей работы' : level === 2 ? 'Важно, какая часть была именно на тебе и почему решение было таким' : 'Важны альтернативы, цена решения и где подход перестаёт работать';
  return `Поясню: речь о теме «${lower(c.title)}» — ${lower(c.focus[gradeForLevel(level)])}. ${what}.`;
}

/** Последняя реплика ИИ при завершении (без LLM). */
export const INTERVIEW_CLOSING_LINE =
  'Спасибо, это все вопросы. Нажми «Завершить» — отдельный оценщик разберёт ответы, и профиль компетенций появится в кабинете.';
