import { afterEach, describe, expect, it } from 'vitest';

import { parseContextBlock } from '@/server/call/prompt-utils';
import type { PlanItem, TranscriptEntry } from '@/server/defense-room/types';
import { computeFlags, evaluateDefenseRoom, medianScores, transcriptTurns } from '@/server/defense-room/verdict';
import { clearStubResponses, createStubProvider, registerStubResponse } from '@/server/llm/providers/stub';

const llm = createStubProvider();
afterEach(() => clearStubResponses());

let index = 0;
const e = (role: TranscriptEntry['role'], text: string, extra: Partial<TranscriptEntry> = {}): TranscriptEntry => ({ index: index++, role, text, at: '', tMs: 0, ...extra });

const ANSWER1 = 'Задержка растёт экспоненциально, чтобы не добивать шлюз во время его сбоя, джиттер разводит повторы.';
const ANSWER2 = 'Set живёт в памяти процесса, поэтому при двух экземплярах дубль пройдёт - нужен общий Redis с TTL.';
const transcript: TranscriptEntry[] = [
  e('ai', 'Привет! Почему задержка растёт экспоненциально?', { defense: { kind: 'greeting', itemId: 'q1' } }),
  e('candidate', ANSWER1),
  e('employer', 'А почему не очередь с повтором?', { userId: 'u1', defense: { speaker: 'ООО Ромашка', companyId: 'co1' } }),
  e('candidate', 'Очередь тоже вариант, но тогда клиент ждёт дольше.'),
  e('ai', 'Вернёмся. Что сломается при трёх экземплярах?', { defense: { kind: 'return', itemId: 'q2' } }),
  e('candidate', ANSWER2),
  e('ai', 'Что будет при пустом списке платежей?', { defense: { kind: 'question', itemId: 'q3' } }),
  e('candidate', 'Вернётся пустой результат, к шлюзу запроса не будет.'),
  e('ai', 'Это все вопросы.', { defense: { kind: 'closing' } }),
];

const crit = (score: number, quote: string) => ({ score, quote, rationale: 'r' });
type Level = 'high' | 'low' | 'mid';
/** Ответ оценщика по вопросам: уровень на каждый пункт (по порядку items в <call_context>). */
function itemsJson(req: { messages: { content: string }[] }, levels: Level[]) {
  const items = parseContextBlock<{ items: { id: string; qa: { answer: string }[] }[] }>(req.messages[0]!.content)?.items ?? [];
  return {
    items: items.map((it, i) => {
      const a = it.qa[0]!.answer;
      const q = a.slice(0, 30);
      const lv = levels[i % levels.length]!;
      const s = lv === 'high' ? [2, 2, 1, 2] : lv === 'mid' ? [1, 1, 1, 1] : [1, 0, 0, 0];
      return { id: it.id, depth: crit(s[0]!, q), why: crit(s[1]!, s[1] ? q : ''), boundary: crit(s[2]!, s[2] ? q : ''), completion: crit(s[3]!, s[3] ? q : '') };
    }),
  };
}

describe('пары для слепого оценщика', () => {
  it('ответ кандидата – с вопросами ИИ перед ним; живые реплики работодателя и завершение не попадают', () => {
    const turns = transcriptTurns(transcript);
    expect(turns).toHaveLength(3);
    expect(turns[0]!.answer).toBe(`${ANSWER1}\nОчередь тоже вариант, но тогда клиент ждёт дольше.`);
    expect(JSON.stringify(turns)).not.toContain('очередь с повтором');
    expect(turns.map((t) => t.question).join(' ')).not.toContain('Это все вопросы');
  });
});

describe('медиана и флаги', () => {
  it('медиана по каждому признаку', () => {
    expect(medianScores([
      { depth: 2, why: 0, boundary: 1, completion: 2 },
      { depth: 1, why: 2, boundary: 1, completion: 0 },
      { depth: 2, why: 1, boundary: 2, completion: 1 },
    ])).toEqual({ depth: 2, why: 1, boundary: 1, completion: 1 });
  });

  it('сильный проект + слабая защита = флаг, не вывод о подделке', () => {
    const base = { answered: 4, runTotals: [3, 3, 3], employerAsked: 0, employerAnswered: 0 };
    expect(computeFlags({ ...base, passed: false, projectScore: 0.9 })).toEqual(['strong_project_weak_defense']);
    expect(computeFlags({ ...base, passed: true, projectScore: 0.9 })).toEqual([]);
    expect(computeFlags({ ...base, passed: false, projectScore: 0.5 })).toEqual([]);
    expect(computeFlags({ ...base, passed: false, projectScore: null })).toEqual(['no_project_result']);
    expect(computeFlags({ ...base, passed: true, projectScore: 1, answered: 2, runTotals: [2, 6, 4], employerAsked: 2, employerAnswered: 1 })).toEqual([
      'short_defense',
      'evaluator_disagreement',
      'employer_questions_unanswered',
    ]);
  });
});

describe('evaluateDefenseRoom: балл по вопросу', () => {
  it('каждый вопрос – свой балл; общий – среднее; без слова «фейк»', async () => {
    const purposes: string[] = [];
    registerStubResponse('call_evaluator', (req) => {
      purposes.push(req.purpose);
      return { json: itemsJson(req, ['high', 'low', 'mid']) };
    });
    const v = await evaluateDefenseRoom({ projectTitle: 'fsp-demo/payments', transcript, projectScore: 0.95, employerAsked: 1, employerAnswered: 1 }, llm);
    expect(purposes).toEqual(['call_evaluator', 'call_evaluator', 'call_evaluator']);
    expect(v.items!.map((i) => [i.itemId, i.total, i.passed])).toEqual([
      ['q1', 7, true],
      ['q2', 1, false],
      ['q3', 4, false],
    ]);
    expect(v.totalMean).toBe(4);
    expect(v.total).toBe(4);
    expect(v.passed).toBe(false);
    expect(v.flags).toEqual(['strong_project_weak_defense', 'uneven_understanding']);
    expect(v.summary).toMatch(/не вывод о подлинности/);
    expect(v.summary).toMatch(/По вопросам:/);
    expect(JSON.stringify(v)).not.toMatch(/фейк|fake|списал/i);
  });

  it('частичное понимание – неровные баллы по вопросам; ровно средние ответы – без флага', async () => {
    registerStubResponse('call_evaluator', (req) => ({ json: itemsJson(req, ['high', 'high', 'low']) }));
    const partial = await evaluateDefenseRoom({ projectTitle: 'p', transcript, projectScore: 0.95, employerAsked: 0, employerAnswered: 0 }, llm);
    clearStubResponses();
    registerStubResponse('call_evaluator', (req) => ({ json: itemsJson(req, ['mid', 'mid', 'mid']) }));
    const none = await evaluateDefenseRoom({ projectTitle: 'p', transcript, projectScore: 0.95, employerAsked: 0, employerAnswered: 0 }, llm);
    expect(partial.flags).toContain('uneven_understanding');
    expect(none.flags).not.toContain('uneven_understanding');
  });

  it('прогоны разошлись (8/5/5 по вопросу) → ещё 2 прогона; разброс по решению → evaluator_disagreement', async () => {
    const seq: Level[][] = [['high'], ['mid'], ['high'], ['mid'], ['mid']];
    let n = 0;
    registerStubResponse('call_evaluator', (req) => ({ json: itemsJson(req, seq[n++]!) }));
    const v = await evaluateDefenseRoom({ projectTitle: 'p', transcript, projectScore: null, employerAsked: 0, employerAnswered: 0 }, llm);
    expect(n).toBe(5);
    expect(v.items![0]!.runs).toHaveLength(5);
    expect(v.items![0]!.agreement).toEqual({ same: 3, of: 5 });
    expect(v.flags).toContain('evaluator_disagreement');
  });

  it('оценщик не видит кода и ожидаемых пунктов – только вопросы и ответы', async () => {
    let content = '';
    registerStubResponse('call_evaluator', (req) => {
      content = req.messages.map((m) => m.content).join('\n');
      return { json: itemsJson(req, ['high']) };
    });
    const v = await evaluateDefenseRoom({ projectTitle: 'p', transcript, projectScore: null, employerAsked: 0, employerAnswered: 0 }, llm);
    expect(content).not.toMatch(/expectedPoints|скрытых тестов/);
    expect(v.passed).toBe(true);
    expect(v.flags).toEqual(['no_project_result']);
  });

  it('подписи вопросов – из плана: тип QLC и файл', async () => {
    registerStubResponse('call_evaluator', (req) => ({ json: itemsJson(req, ['high']) }));
    const plan: PlanItem[] = [
      { source: 'qlc', id: 'q1', type: 'why', question: 'Почему экспонента?', ref: 'src/retry.ts:L1-L9', expectedPoints: ['секрет'], answered: true, followUps: 0 },
      { source: 'qlc', id: 'q2', type: 'what_breaks', question: 'Что сломается?', ref: 'src/dedupe.ts:L3-L8', expectedPoints: [], answered: true, followUps: 0 },
    ];
    const v = await evaluateDefenseRoom({ projectTitle: 'p', transcript, plan, projectScore: null, employerAsked: 0, employerAnswered: 0 }, llm);
    expect(v.items![0]!.label).toBe('почему так · src/retry.ts:L1-L9');
    expect(v.items![1]!.label).toBe('что сломается · src/dedupe.ts:L3-L8');
  });

  it('молчание не считается ответом: short_defense срабатывает; у признака с баллом 0 цитаты нет', async () => {
    const silent: TranscriptEntry[] = [
      e('ai', 'Почему задержка растёт экспоненциально?', { defense: { kind: 'question', itemId: 'q1' } }),
      e('candidate', '(молчание)'),
      e('ai', 'Что сломается при трёх экземплярах?', { defense: { kind: 'question', itemId: 'q2' } }),
      e('candidate', ''),
      e('ai', 'Что будет при пустом списке?', { defense: { kind: 'question', itemId: 'q3' } }),
      e('candidate', ANSWER2),
    ];
    registerStubResponse('call_evaluator', (req) => {
      const items = parseContextBlock<{ items: { id: string; qa: { answer: string }[] }[] }>(req.messages[0]!.content)!.items;
      // Оценщик приложил дословную цитату к нулевому баллу – показывать её как доказательство нельзя.
      return { json: { items: items.map((it) => ({ id: it.id, depth: crit(0, ANSWER2.slice(0, 30)), why: crit(0, ''), boundary: crit(0, ''), completion: crit(0, '') })) } };
    });
    const v = await evaluateDefenseRoom({ projectTitle: 'p', transcript: silent, projectScore: 0.9, employerAsked: 0, employerAnswered: 0 }, llm);
    expect(v.answered).toBe(1);
    expect(v.items!.map((i) => i.answers)).toEqual([0, 0, 1]);
    expect(v.flags).toContain('short_defense');
    expect(v.items!.every((i) => i.quote === '')).toBe(true);
    expect(v.quotes).toEqual([]);
  });

  it('нет ответов – оценки нет, флаг short_defense', async () => {
    const v = await evaluateDefenseRoom({ projectTitle: 'p', transcript: [transcript[0]!], projectScore: 0.9, employerAsked: 0, employerAnswered: 0 }, llm);
    expect(v.total).toBeNull();
    expect(v.items).toEqual([]);
    expect(v.flags).toContain('short_defense');
  });
});
