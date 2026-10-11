import { decideStatus, evaluateCall, needsExtraRuns, notProbedItem, redactFacts, retellsProfile, sharedNgramSpans, type EvalTopic } from '@/server/call/evaluator';
import { coverage, planNext, type TopicSeed } from '@/server/call/plan';
import { clearStubResponses, createStubProvider, registerStubResponse } from '@/server/llm/providers/stub';
import type { TopicScores } from '@/server/call/types';

const sc = (depth: 0 | 1 | 2, why: 0 | 1 | 2, boundary: 0 | 1 | 2, completion: 0 | 1 | 2): TopicScores => ({ depth, why, boundary, completion });
const ANSWER = 'Делал составной индекс по status и created_at, потому что фильтр сначала по статусу, проверил через EXPLAIN.';
const topics: EvalTopic[] = [{ topic: 'Индексы', catalogId: 'be.idx', claimed: true, claimStatement: null, maxLevel: 2, qa: [{ question: 'Как выбирал индекс?', answer: ANSWER, level: 2 }] }];
const crit = (score: 0 | 1 | 2) => ({ quote: 'Делал составной индекс по status и created_at', rationale: 'r', score });
const out = (d: 0 | 1 | 2, w: 0 | 1 | 2, b: 0 | 1 | 2, c: 0 | 1 | 2) => ({ topics: [{ topic: 'Индексы', depth: crit(d), why: crit(w), boundary: crit(b), completion: crit(c) }] });

afterEach(() => clearStubResponses());

describe('решение по теме: согласие прогонов (валидация 10.10)', () => {
  it('3 из 3 согласны – решение принято', () => {
    expect(decideStatus(sc(2, 1, 1, 1), [sc(2, 1, 1, 1), sc(2, 2, 1, 1), sc(1, 1, 1, 2)]).status).toBe('confirmed');
    expect(decideStatus(sc(1, 0, 1, 1), [sc(1, 0, 1, 1), sc(1, 1, 0, 1), sc(0, 0, 1, 1)]).status).toBe('not_confirmed');
  });

  it('2 из 3 – inconclusive; 4 из 5 – решение; 3 из 5 – inconclusive', () => {
    expect(decideStatus(sc(2, 1, 1, 1), [sc(2, 1, 1, 1), sc(2, 1, 1, 1), sc(1, 1, 1, 0)]).status).toBe('inconclusive');
    const pass = sc(2, 1, 1, 1);
    const fail = sc(1, 1, 1, 0);
    expect(decideStatus(pass, [pass, pass, pass, pass, fail])).toEqual({ status: 'confirmed', same: 4 });
    expect(decideStatus(pass, [pass, pass, pass, fail, fail]).status).toBe('inconclusive');
  });

  it('добавочные прогоны: разброс суммы > 2 или разные решения', () => {
    expect(needsExtraRuns([[sc(2, 2, 2, 2)], [sc(2, 1, 1, 1)], [sc(2, 2, 1, 1)]])).toBe(true); // 8 / 5 / 6
    expect(needsExtraRuns([[sc(2, 1, 1, 1)], [sc(1, 1, 1, 1)], [sc(2, 1, 1, 1)]])).toBe(true); // 5 / 4 / 5: разброс 1, но решение разное
    expect(needsExtraRuns([[sc(1, 0, 1, 1)], [sc(1, 1, 0, 1)], [sc(0, 0, 1, 1)]])).toBe(false);
  });

  it('evaluateCall: 3 прогона при согласии, 5 – при расхождении 8/5/5', async () => {
    registerStubResponse('call_evaluator', () => ({ json: out(2, 1, 1, 1) }));
    expect((await evaluateCall('backend', topics, createStubProvider())).runs).toBe(3);
    clearStubResponses();
    const seq = [out(2, 2, 2, 2), out(2, 1, 1, 1), out(1, 2, 1, 1), out(2, 1, 1, 1), out(2, 1, 1, 1)];
    let i = 0;
    registerStubResponse('call_evaluator', () => ({ json: seq[i++] }));
    const ev = await evaluateCall('backend', topics, createStubProvider());
    expect(ev.runs).toBe(5);
    expect(ev.depthMap[0]!.runs).toHaveLength(5);
  });

  it('тема без вопросов – not_probed, не подтверждена', () => {
    const d = notProbedItem({ topic: 'Кэш', catalogId: 'be.cache', claimStatement: 'Кэшировал в Redis' });
    expect(d).toMatchObject({ status: 'not_probed', confirmed: false, probed: 0, claimed: true });
  });
});

describe('слепота: пересказ профиля (n-граммы ≥ 4 слов)', () => {
  const claim = 'Кэшировал курсы валют в Redis с TTL пять минут';
  it('ловит пересказ близко к тексту, не ловит вопрос о теме своими словами', () => {
    expect(retellsProfile('Ты писал, что кэшировал курсы валют в Redis – как выбирал TTL?', [claim])).toBe(true);
    expect(retellsProfile('Как ты решаешь, что и на сколько класть в кэш?', [claim])).toBe(false);
    expect(retellsProfile('Почему Redis, а не кэш в памяти процесса?', [claim])).toBe(false);
  });

  it('регистр и ё не важны; перекрывающиеся совпадения сливаются', () => {
    expect(sharedNgramSpans('КЭШИРОВАЛ КУРСЫ ВАЛЮТ В REDIS С TTL', [claim])).toHaveLength(1);
  });

  it('redactFacts вырезает пересказ перед оценщиком', () => {
    const q = redactFacts('Ты писал, что кэшировал курсы валют в Redis. Почему так?', [claim]);
    expect(q).not.toMatch(/курсы валют в redis/i);
    expect(q).toContain('[фрагмент профиля скрыт от оценщика]');
    expect(q).toContain('Почему так?');
  });
});

describe('покрытие тем', () => {
  const seeds: TopicSeed[] = ['A', 'B', 'C', 'D'].map((t) => ({ topic: t, catalogId: `be.${t}`, claimStatement: 'x', resumeFact: null }));
  const turn = (topic: string, level: 1 | 2 | 3 = 2) => ({ question: 'Вопрос?', answer: 'длинный ответ '.repeat(20), topic, catalogId: null, level });

  it('непроверенных тем столько же, сколько осталось вопросов → обязательно новая тема', () => {
    // 6 вопросов, 4 темы: после двух вопросов по A осталось 4 вопроса и 3 темы – ещё можно; после A,A,B – 3 и 2.
    expect(coverage(seeds, [turn('A'), turn('A')], 6).mustSwitch).toBe(false);
    expect(coverage(seeds, [turn('A'), turn('B'), turn('B')], 4).mustSwitch).toBe(true);
    const plan = planNext({ topics: seeds, turns: [turn('A', 1), turn('B', 1), turn('C', 1), turn('C', 1)], grade: 'junior', signal: 'strong', maxQuestions: 5 });
    expect(seeds[plan.topicIndex]!.topic).toBe('D');
  });

  it('за 6 вопросов запасной план спрашивает все 4 темы', () => {
    const turns: ReturnType<typeof turn>[] = [];
    for (let i = 0; i < 6; i++) {
      const p = planNext({ topics: seeds, turns, grade: 'junior', signal: turns.length ? 'strong' : null, maxQuestions: 6 });
      turns.push(turn(seeds[p.topicIndex]!.topic, p.level));
    }
    expect(new Set(turns.map((t) => t.topic)).size).toBe(4);
  });
});
