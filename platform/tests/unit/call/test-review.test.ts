// Связь теста и созвона (11.10): выбор заданий, состояние этапа, вопросы, оценка «решил сам», схема итога.
import { evaluateOwnership, loadTestReview, nextReviewQuestion, pickReviewItems, reviewDialog, reviewState, type AnsweredRow, type ReviewItem } from '@/server/call/test-review';
import { publicVerdict } from '@/server/call/access';
import { questionTurns } from '@/server/call/drivers';
import type { CallVerdict, TranscriptEntry } from '@/server/call/types';
import { summarizeQualifying } from '@/server/employer/stages';
import { clearStubResponses, createStubProvider, registerStubResponse } from '@/server/llm/providers/stub';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock('@/server/db', () => ({ prisma: { testAttempt: { findFirst }, testItem: { findMany: vi.fn() } } }));

const row = (index: number, irtB: number, correct: boolean | null, answer: string | null = 'ответ'): AnsweredRow => ({
  index,
  templateId: `t${index}`,
  title: `Задание ${index}`,
  catalogIds: [],
  irtB,
  prompt: 'Условие '.repeat(100),
  code: null,
  answer,
  correct,
  answerKey: '42',
  explanation: 'Разбор',
});

afterEach(() => {
  clearStubResponses();
  findFirst.mockReset();
});

describe('pickReviewItems', () => {
  it('первое — верное, ближайшее по сложности к порогу грейда; второе — неверное', () => {
    // порог middle = -0.1
    const items = pickReviewItems([row(0, -1.2, true), row(1, 0.0, true), row(2, 1.5, false), row(3, -0.3, false)], 'middle');
    expect(items.map((i) => i.templateId)).toEqual(['t1', 't3']);
    expect(items[0]!.correct).toBe(true);
    expect(items[0]!.prompt.length).toBeLessThanOrEqual(500);
  });
  it('нет неверных — второе верное; нет верных — первое неверное; детерминированно при ничьей', () => {
    expect(pickReviewItems([row(0, 0, true), row(1, 0.5, true)], 'junior').map((i) => i.templateId)).toEqual(['t0', 't1']);
    expect(pickReviewItems([row(0, 2, false)], 'junior').map((i) => i.templateId)).toEqual(['t0']);
    const tie = [row(1, 0.3, true), row(0, -0.5, true)];
    expect(pickReviewItems(tie, 'middle')).toEqual(pickReviewItems([...tie].reverse(), 'middle'));
  });
  it('без ответов — пусто (блок пропускается)', () => {
    expect(pickReviewItems([], 'middle')).toEqual([]);
    expect(pickReviewItems([row(0, 0, null, null)], 'middle')).toEqual([]);
  });
});

describe('нет попытки теста', () => {
  it('loadTestReview → [] без обращения к заданиям', async () => {
    findFirst.mockResolvedValue(null);
    expect(await loadTestReview('c1', 'backend', 'backend.web-api')).toEqual([]);
    expect(findFirst).toHaveBeenCalledOnce();
  });
});

const ai = (index: number, text: string, testReview?: 1 | 2): TranscriptEntry => ({
  index,
  role: 'ai',
  text,
  at: '',
  tMs: 0,
  meta: { topic: 'Тема', catalogId: null, level: 2, routedBy: null, ...(testReview ? { testReview: { step: testReview, templateId: 't1' } } : {}) },
});
const cand = (index: number, text: string): TranscriptEntry => ({ index, role: 'candidate', text, at: '', tMs: 0 });

describe('этап в транскрипте', () => {
  const t = [ai(0, 'Вопрос 1'), cand(1, 'Ответ 1'), ai(2, 'Разбор?', 1), cand(3, 'Решал так'), ai(4, 'А если?', 2)];
  it('reviewState/reviewDialog считают только вопросы этапа', () => {
    expect(reviewState(t)).toEqual({ asked: 2, answered: 1 });
    expect(reviewDialog(t)).toEqual([{ question: 'Разбор?', answer: 'Решал так' }, { question: 'А если?', answer: null }]);
    expect(reviewState([ai(0, 'x'), cand(1, 'y')])).toEqual({ asked: 0, answered: 0 });
  });
  it('questionTurns не видит этап и не приклеивает его ответы к прошлому вопросу', () => {
    const turns = questionTurns(t);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.answer).toBe('Ответ 1');
  });
});

const items: ReviewItem[] = pickReviewItems([row(0, 0, true), row(1, 1, false)], 'middle');

describe('nextReviewQuestion', () => {
  it('принимает русский вопрос модели; ключ в вопросе или латиница → шаблон', async () => {
    registerStubResponse('call_interviewer', () => ({ json: { question: 'Расскажи, как ты решал это задание и почему так?' } }));
    const ok = await nextReviewQuestion(items, 1, [], createStubProvider());
    expect(ok).toEqual({ question: 'Расскажи, как ты решал это задание и почему так?', fallback: false });
    registerStubResponse('call_interviewer', () => ({ json: { question: 'Please explain how you solved it' } }));
    const bad = await nextReviewQuestion(items, 2, [], createStubProvider());
    expect(bad.fallback).toBe(true);
    expect(bad.question).toMatch(/изменилось бы/);
  });
  it('stub без регистрации: шаблонная реплика по названию задания', async () => {
    const r = await nextReviewQuestion(items, 1, [], createStubProvider());
    expect(r.question).toContain('Задание 0');
  });
});

describe('evaluateOwnership', () => {
  const dialog = [{ question: 'Разбор?', answer: 'Сначала я отфильтровал строки, потом посчитал группы и получилось сорок два.' }];
  const out = (status: string, quote: string) => ({ json: { quote, reason: 'потому что', status } });

  it('объяснил с дословной цитатой — explained; без цитаты — partial', async () => {
    registerStubResponse('call_evaluator', () => out('explained', 'отфильтровал строки, потом посчитал группы'));
    expect((await evaluateOwnership(items, dialog, createStubProvider())).status).toBe('explained');
    registerStubResponse('call_evaluator', () => out('explained', 'выдуманная цитата которой нет в ответе'));
    expect((await evaluateOwnership(items, dialog, createStubProvider())).status).toBe('partial');
  });
  it('не проверялось: нет этапа, нет ответа, сбой оценщика', async () => {
    expect((await evaluateOwnership(items, [], createStubProvider())).status).toBe('not_checked');
    expect((await evaluateOwnership(items, [{ question: 'q', answer: null }], createStubProvider())).status).toBe('not_checked');
    registerStubResponse('call_evaluator', () => {
      throw new Error('503');
    });
    expect((await evaluateOwnership(items, dialog, createStubProvider())).status).toBe('not_checked');
  });
  it('failed проходит как есть; в items — название и верность', async () => {
    registerStubResponse('call_evaluator', () => out('failed', ''));
    const r = await evaluateOwnership(items, dialog, createStubProvider());
    expect(r.status).toBe('failed');
    expect(r.items).toEqual([
      { templateId: 't0', title: 'Задание 0', correct: true },
      { templateId: 't1', title: 'Задание 1', correct: false },
    ]);
  });
});

describe('итог созвона', () => {
  const verdict = {
    kind: 'qualifying',
    depthMap: [],
    testOwnership: { status: 'failed', reason: 'Не помнит ход, цитирует кандидата', items: [{ templateId: 't0', title: 'Задание 0', correct: true }] },
    summary: '',
    evaluatedAt: '2026-10-11T00:00:00Z',
    thresholdVersion: 'v',
  } as unknown as CallVerdict;
  it('публичный вердикт: статус и названия, без причины', () => {
    expect(publicVerdict(verdict).testOwnership).toEqual({ status: 'failed', items: [{ title: 'Задание 0' }] });
    expect(JSON.stringify(publicVerdict(verdict))).not.toContain('Не помнит');
  });
  it('карточка работодателя: статус из публичного вердикта; not_checked и отсутствие — без поля', () => {
    expect(summarizeQualifying(publicVerdict(verdict) as never).testOwnership).toBe('failed');
    const nc = { ...verdict, testOwnership: { ...verdict.testOwnership!, status: 'not_checked' } } as CallVerdict;
    expect(summarizeQualifying(publicVerdict(nc) as never)).not.toHaveProperty('testOwnership');
    expect(summarizeQualifying({ depthMap: [], evaluatedAt: 'x' })).not.toHaveProperty('testOwnership');
  });
});
