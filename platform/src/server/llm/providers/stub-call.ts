// Детерминированные ответы заглушки для созвона (lane call, ADR 0003): call_interviewer и call_evaluator.
// Разбирают тот же JSON `<call_context>`, что видит модель, и считают ответ правилами без случайности.
import type { InterviewerPayload } from '../../call/interviewer';
import type { EvaluatorPayload } from '../../call/evaluator';
import { heuristicSignal, planNext, templateQuestion, type TopicSeed } from '../../call/plan';
import { parseContextBlock } from '../../call/prompt-utils';
import type { QuestionLevel } from '../../call/types';
import type { ChatMessage, CompleteRequest } from '../types';

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === 'user') return messages[i]!.content;
  return '';
}

function firstUserText(messages: ChatMessage[]): string {
  return messages.find((m) => m.role === 'user')?.content ?? '';
}

/** Интервьюер: сигнал — эвристика по длине ответа, тема и уровень — planNext (как запасной путь). */
export function stubCallInterviewer(req: CompleteRequest): { kind: 'json'; json: unknown } | undefined {
  const p = parseContextBlock<InterviewerPayload>(lastUserText(req.messages));
  if (!p) return undefined;
  const topics: TopicSeed[] = p.topics.map((t) => ({ topic: t.topic, catalogId: t.catalogId, claimStatement: t.claim, resumeFact: t.resumeFact }));
  const turns = p.turns.map((t) => ({ question: t.question, answer: t.answer, topic: t.topic, catalogId: null, level: t.level as QuestionLevel }));
  const last = turns[turns.length - 1];
  const signal = last ? heuristicSignal(last.answer) : null;
  const grade = p.claimedGrade === 'middle' ? 'middle' : p.claimedGrade === 'junior' ? 'junior' : null;
  const plan = planNext({ topics, turns, grade, signal });
  const seed = topics[plan.topicIndex] ?? { topic: p.specialization, catalogId: null, claimStatement: null, resumeFact: null };
  return {
    kind: 'json',
    json: {
      answerSignal: signal ?? 'none',
      topic: seed.topic,
      catalogId: seed.catalogId,
      question: `[stub] ${templateQuestion(seed, plan.level, turns.length === 0)}`,
      done: p.next.questionNumber > p.next.minQuestions,
    },
  };
}

const WHY_RE = /(потому что|поэтому|вместо|альтернатив|компромисс|цена|дороже|дешевле|рассматривал)/i;
const BOUNDARY_RE = /(не уверен|не знаю|проверил бы|предполагаю|думаю|скорее всего)/i;
const DONE_RE = /(в итоге|результат|измерил|проверил|снизил|ускорил|выросл|упал)/i;

/** Первое предложение ответа длиной ≥ 5 символов — дословная цитата (проходит checkQuote). */
function sentence(answer: string, re?: RegExp): string {
  const parts = answer.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.replace(/\s/g, '').length >= 5);
  const hit = re ? parts.find((s) => re.test(s)) : parts[0];
  return (hit ?? '').slice(0, 300);
}

/** Оценщик: баллы из признаков в тексте ответов — длина, «почему», граница, результат. */
export function stubCallEvaluator(req: CompleteRequest): { kind: 'json'; json: unknown } | undefined {
  const p = parseContextBlock<EvaluatorPayload>(firstUserText(req.messages));
  if (!p) return undefined;
  return {
    kind: 'json',
    json: {
      topics: p.topics.map((t) => {
        const answers = t.qa.map((x) => x.answer).filter((a) => a !== '(кандидат не ответил)');
        const all = answers.join(' ');
        const crit = (re: RegExp | undefined, score: (q: string) => 0 | 1 | 2) => {
          const q = answers.map((a) => sentence(a, re)).find(Boolean) ?? '';
          return { quote: q, rationale: '[stub] правило по тексту ответа', score: q ? score(q) : 0 };
        };
        return {
          topic: t.topic,
          depth: crit(undefined, () => (all.length >= 160 ? 2 : all.length >= 60 ? 1 : 0)),
          why: crit(WHY_RE, () => (WHY_RE.test(all) && all.length >= 120 ? 2 : 1)),
          boundary: crit(BOUNDARY_RE, () => 2),
          completion: crit(DONE_RE, () => (all.length >= 120 ? 2 : 1)),
        };
      }),
    },
  };
}
