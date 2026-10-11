import { nextCallQuestion, type InterviewerInput } from '@/server/call/interviewer';
import { retellsProfile } from '@/server/call/evaluator';
import { CALL_LIMITS } from '@/server/call/plan';
import { clearStubResponses, createStubProvider, registerStubResponse } from '@/server/llm/providers/stub';

const claim = 'Кэшировал курсы валют в Redis с TTL пять минут';
const input: InterviewerInput = {
  specialization: 'backend',
  claimedGrade: 'junior',
  topics: [
    { topic: 'Кэширование', catalogId: 'be.cache', claimStatement: claim, resumeFact: 'настроил кэш курсов валют в Redis' },
    { topic: 'Индексы', catalogId: 'be.idx', claimStatement: 'Ускорял запросы индексами', resumeFact: null },
  ],
  turns: [],
  limits: CALL_LIMITS,
};
const q = (question: string, topic = 'Кэширование') => ({ json: { answerSignal: 'none', topic, catalogId: null, question, done: false } });

afterEach(() => clearStubResponses());

describe('интервьюер не пересказывает профиль', () => {
  it('пересказ → одна переформулировка; чистый вопрос принимается', async () => {
    const outs = [q('Привет! Ты кэшировал курсы валют в Redis – как выбирал TTL?'), q('Привет! Как ты решаешь, что класть в кэш и на сколько?')];
    let calls = 0;
    registerStubResponse('call_interviewer', () => outs[calls++]);
    const r = await nextCallQuestion(input, createStubProvider());
    expect(calls).toBe(2);
    expect(r.question).toContain('что класть в кэш');
    expect(r.meta.fallback).toBeUndefined();
    expect(retellsProfile(r.question, [claim])).toBe(false);
  });

  it('пересказ дважды → вопрос из шаблона (без формулировок профиля)', async () => {
    registerStubResponse('call_interviewer', () => q('Ты кэшировал курсы валют в Redis с TTL пять минут – почему?'));
    const r = await nextCallQuestion(input, createStubProvider());
    expect(r.meta.fallback).toBe(true);
    expect(retellsProfile(r.question, [claim, 'настроил кэш курсов валют в Redis'])).toBe(false);
  });

  it('дополнительный вопрос по неопределённой теме: тема и уровень – от кода, meta.probe', async () => {
    const turns = [{ question: 'Q', answer: 'A', topic: 'Кэширование', catalogId: 'be.cache', level: 2 as const }];
    registerStubResponse('call_interviewer', () => q('Что сломается, если кэш отдаст устаревший курс?'));
    const r = await nextCallQuestion({ ...input, turns, force: { topic: 'Кэширование', level: 3 } }, createStubProvider());
    expect(r.meta).toMatchObject({ topic: 'Кэширование', level: 3, probe: 'inconclusive' });
    clearStubResponses();
    registerStubResponse('call_interviewer', () => q('Как выбираешь индекс?', 'Индексы'));
    const off = await nextCallQuestion({ ...input, turns, force: { topic: 'Кэширование', level: 3 } }, createStubProvider());
    expect(off.meta).toMatchObject({ topic: 'Кэширование', fallback: true, probe: 'inconclusive' });
  });
});
