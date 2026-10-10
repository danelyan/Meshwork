import { describe, expect, it } from 'vitest';

import type { DefenseScores } from '@/server/defense/types';
import type { CompleteRequest } from '@/server/llm/types';

import {
  addUsage,
  callTables,
  defenseSeparation,
  defenseTables,
  diffMeter,
  emptyMeter,
  separation,
  spread,
  summarizeCallPersona,
  summarizeDefensePersona,
  sumMeters,
  type CallObs,
  type DefenseObs,
} from '../../../eval/stages/metrics';
import { answersOf, stubDefenseEvaluator } from '../../../eval/stages/stub-defense';

const S = (depth: number, why: number, boundary: number, completion: number) => ({ depth, why, boundary, completion }) as DefenseScores;

function call(persona: string, n: number, topics: CallObs['topics'], platformCalls = 10): CallObs {
  const platform = emptyMeter();
  for (let i = 0; i < platformCalls; i++) addUsage(platform, 'call_interviewer', { inputTokens: 100, outputTokens: 10 });
  return { persona, call: n, sessionId: `s${n}`, questions: 5, fallbackQuestions: 0, validRuns: 3, topics, platform, persona_llm: emptyMeter() };
}

function topic(catalogId: string, expected: boolean | null, runs: DefenseScores[], confirmed: boolean, total: number): CallObs['topics'][number] {
  return { topic: catalogId, catalogId, expected, confirmed, total, probed: 2, maxLevel: 2, runs };
}

describe('eval/stages: счётчик LLM', () => {
  it('считает вызовы, ошибки и токены по purpose; разница и сумма снимков', () => {
    const m = emptyMeter();
    addUsage(m, 'call_evaluator', { inputTokens: 1000, outputTokens: 200 });
    const before = JSON.parse(JSON.stringify(m));
    addUsage(m, 'call_evaluator', { inputTokens: 500, outputTokens: 50 });
    addUsage(m, 'smoke', null);
    expect(m).toMatchObject({ calls: 3, failures: 1, inputTokens: 1500, outputTokens: 250 });
    const d = diffMeter(m, before);
    expect(d).toMatchObject({ calls: 2, failures: 1, inputTokens: 500, outputTokens: 50 });
    expect(d.byPurpose).toEqual({ call_evaluator: { calls: 1, failures: 0, inputTokens: 500, outputTokens: 50 }, smoke: { calls: 1, failures: 1, inputTokens: 0, outputTokens: 0 } });
    expect(sumMeters([d, d]).byPurpose.call_evaluator!.inputTokens).toBe(1000);
  });
});

describe('eval/stages: статистики', () => {
  it('spread и разведение (AUC с ничьими)', () => {
    expect(spread([3, 7, 5])).toBe(4);
    expect(spread([])).toBe(0);
    expect(separation([8, 7], [1, 2])).toBe(1);
    expect(separation([5], [5])).toBe(0.5);
    expect(separation([5, 1], [3])).toBe(0.5);
    expect(separation([], [1])).toBeNull();
  });
});

describe('eval/stages: ступень 1 (созвон)', () => {
  const expected = { 'be.a': true, 'be.b': true, 'be.c': false };
  const calls = [
    call('A', 1, [topic('be.a', true, [S(2, 2, 1, 2), S(2, 1, 1, 2), S(2, 2, 2, 2)], true, 7), topic('be.c', false, [S(1, 0, 1, 0), S(1, 1, 1, 1), S(1, 0, 1, 0)], false, 2)]),
    call('A', 2, [topic('be.a', true, [S(2, 2, 1, 2), S(2, 2, 1, 2), S(2, 2, 1, 2)], true, 7), topic('be.b', true, [S(1, 1, 1, 1), S(1, 1, 1, 1), S(1, 1, 1, 1)], false, 4)]),
    { ...call('A', 3, []), error: 'оценщик недоступен' },
  ];
  const s = summarizeCallPersona('A', expected, calls);

  it('доля подтверждённых, совпадение с ожиданием и покрытие считаются по успешным созвонам', () => {
    expect(s.calls).toBe(3);
    expect(s.failedCalls).toBe(1);
    expect(s.confirmedShare).toBe(2 / 4);
    // be.a ✓ (ожид. да) ×2, be.c ✗ (нет) — совпало; be.b ✗ (да) — нет.
    expect(s.matched).toBe(3);
    expect(s.judged).toBe(4);
    expect(s.matchRate).toBe(0.75);
    // 2 созвона × 3 ожидаемые темы; спрошено 2 + 2.
    expect(s.coverage).toBe(4 / 6);
  });

  it('карта «тема → ожидалось → получено» по созвонам, · для неспрошенной темы', () => {
    const a = s.topics.find((t) => t.catalogId === 'be.a')!;
    expect(a).toMatchObject({ expected: true, got: [true, true], totals: [7, 7] });
    expect(s.topics.find((t) => t.catalogId === 'be.b')).toMatchObject({ got: [null, false], totals: [null, 4] });
  });

  it('повторяемость: разброс между прогонами, согласие порога, согласие между созвонами', () => {
    // Суммы прогонов: be.a#1 7/6/8 → 2; be.c 2/4/2 → 2; be.a#2 7/7/7 → 0; be.b 4/4/4 → 0.
    expect(s.withinSpreadMax).toBe(2);
    expect(s.withinSpreadMean).toBe(1);
    // Порог (≥5, why≥1, ≤1 нуля): be.a#1 все прошли; be.c все нет; остальные одинаковы → 100 %.
    expect(s.withinPassAgreement).toBe(1);
    // Только be.a спрошена дважды, решения совпали.
    expect(s.betweenAgreement).toBe(1);
    expect(s.betweenSpreadMean).toBe(0);
    expect(s.avgPlatformCalls).toBe(10);
  });

  it('таблица markdown содержит строку персоны и карту тем', () => {
    const md = callTables([s], { A: '(a) сильный Junior' });
    expect(md).toContain('| A (a) сильный Junior | 2/3 | 50 % | 75 % (3/4) | 67 % |');
    expect(md).toContain('| A | `be.b` | да | · ✗ | · / 4 |');
  });
});

describe('eval/stages: ступень 3 (защита)', () => {
  const d = (persona: string, n: number, total: number | null, runs: number[], flags: string[], extra: Partial<DefenseObs> = {}): DefenseObs => ({
    persona,
    defense: n,
    sessionId: `d${n}`,
    total,
    passed: total === null ? null : total >= 5,
    runs,
    flags,
    answered: 6,
    followUps: 1,
    generator: 'llm',
    projectScore: 0.95,
    platform: emptyMeter(),
    persona_llm: emptyMeter(),
    ...extra,
  });
  const own = summarizeDefensePersona('own', [d('own', 1, 7, [7, 6, 7], []), d('own', 2, 6, [6, 6, 8], []), d('own', 3, null, [], [], { error: '503' })]);
  const ai = summarizeDefensePersona('ai-only', [d('ai-only', 1, 2, [2, 2, 3], ['strong_project_weak_defense']), d('ai-only', 2, 6, [6, 5, 6], [])]);

  it('сумма, порог, доля флага, повторяемость; ошибки не входят в средние', () => {
    expect(own).toMatchObject({ defenses: 3, failed: 1, totals: [7, 6], meanTotal: 6.5, passRate: 1, flagRate: 0, withinSpreadMax: 2, betweenSpread: 1 });
    expect(own.withinSpreadMean).toBe(1.5);
    expect(ai).toMatchObject({ passRate: 0.5, flagRate: 0.5, betweenSpread: 4 });
  });

  it('разведение персон попарно и таблица', () => {
    expect(defenseSeparation([own, ai])).toEqual([{ a: 'own', b: 'ai-only', auc: 0.88 }]);
    const md = defenseTables([own, ai], { own: '(a)', 'ai-only': '(b)' });
    expect(md).toContain('| own (a) | 2/3 | 7 / 6 | 6,5 | 100 % | 0 % | 1,5 / 2 | 1 |');
    expect(md).toContain('| own над ai-only | 0,88 |');
  });
});

describe('eval/stages: stub оценщика защиты', () => {
  const req = (answers: string[]): CompleteRequest => ({
    purpose: 'call_evaluator',
    system: '',
    messages: [{ role: 'user', content: `<transcript>\n${answers.map((a, i) => `<turn n="${i + 1}"><question>q</question><candidate_answer>${a}</candidate_answer></turn>`).join('\n')}\n</transcript>` }],
  });

  it('детерминированные баллы с дословными цитатами; чужой формат — не его', () => {
    const long = 'Сделал так, потому что альтернатива дороже по памяти. Не уверен насчёт кластера, проверил бы нагрузкой. В итоге тесты проходят &amp; лимит держится, и это видно по метрикам за неделю работы.';
    expect(answersOf(req([long]).messages[0]!.content)[0]).toContain('& лимит');
    const strong = stubDefenseEvaluator(req([long]))!.json as Record<string, { score: number; quote: string }>;
    expect(strong.depth!.score).toBe(2);
    expect(strong.why!.quote).toMatch(/потому что/);
    const weak = stubDefenseEvaluator(req(['Ну, так правильнее.']))!.json as Record<string, { score: number }>;
    expect(weak.depth!.score + weak.why!.score + weak.boundary!.score + weak.completion!.score).toBeLessThan(5);
    expect(stubDefenseEvaluator({ ...req([]), messages: [{ role: 'user', content: '<call_context>{}</call_context>' }] })).toBeUndefined();
  });
});
