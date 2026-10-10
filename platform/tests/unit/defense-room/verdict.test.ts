import { afterEach, describe, expect, it } from 'vitest';

import type { TranscriptEntry } from '@/server/defense-room/types';
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
function evalJson(total: 'high' | 'low' | 'mid') {
  if (total === 'high') return { depth: crit(2, ANSWER1.slice(0, 40)), why: crit(2, 'нужен общий Redis с TTL'), boundary: crit(1, 'Очередь тоже вариант'), completion: crit(2, 'джиттер разводит повторы'), advice: '' };
  if (total === 'mid') return { depth: crit(1, ANSWER1.slice(0, 40)), why: crit(1, 'нужен общий Redis с TTL'), boundary: crit(1, 'Очередь тоже вариант'), completion: crit(1, 'джиттер разводит повторы'), advice: '' };
  return { depth: crit(1, ANSWER1.slice(0, 40)), why: crit(0, ''), boundary: crit(0, ''), completion: crit(0, ''), advice: '' };
}

describe('пары для слепого оценщика', () => {
  it('ответ кандидата — с вопросами ИИ перед ним; живые реплики работодателя и завершение не попадают', () => {
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

describe('evaluateDefenseRoom', () => {
  it('три прогона call_evaluator, медиана, разброс → флаг; без слова «фейк»', async () => {
    const order: ('high' | 'low' | 'mid')[] = ['high', 'low', 'mid'];
    let n = 0;
    const purposes: string[] = [];
    registerStubResponse('call_evaluator', (req) => {
      purposes.push(req.purpose);
      return { json: evalJson(order[n++ % 3]!) };
    });
    const v = await evaluateDefenseRoom({ projectTitle: 'fsp-demo/payments', transcript, projectScore: 0.95, employerAsked: 1, employerAnswered: 1 }, llm);
    expect(purposes).toEqual(['call_evaluator', 'call_evaluator', 'call_evaluator']);
    expect(v.runs.sort()).toEqual([1, 4, 7]);
    expect(v.scores).toEqual({ depth: 1, why: 1, boundary: 1, completion: 1 });
    expect(v.total).toBe(4);
    expect(v.passed).toBe(false);
    expect(v.flags).toEqual(['strong_project_weak_defense', 'evaluator_disagreement']);
    expect(v.summary).toMatch(/не вывод о подлинности/);
    expect(JSON.stringify(v)).not.toMatch(/фейк|fake|списал/i);
  });

  it('оценщик не видит кода и ожидаемых пунктов — только пары вопрос/ответ', async () => {
    let content = '';
    registerStubResponse('call_evaluator', (req) => {
      content = req.messages.map((m) => m.content).join('\n');
      return { json: evalJson('high') };
    });
    const v = await evaluateDefenseRoom({ projectTitle: 'p', transcript, projectScore: null, employerAsked: 0, employerAnswered: 0 }, llm);
    expect(content).not.toMatch(/src\/|expectedPoints|скрытых тестов/);
    expect(v.passed).toBe(true);
    expect(v.flags).toEqual(['no_project_result']);
  });

  it('нет ответов — оценки нет, флаг short_defense', async () => {
    const v = await evaluateDefenseRoom({ projectTitle: 'p', transcript: [transcript[0]!], projectScore: 0.9, employerAsked: 0, employerAnswered: 0 }, llm);
    expect(v.total).toBeNull();
    expect(v.flags).toContain('short_defense');
  });
});
