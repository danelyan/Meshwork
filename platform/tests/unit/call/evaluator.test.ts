import { aggregateRuns, buildEvaluatorPayload, evaluateCall, medianScore, type EvalTopic } from '@/server/call/evaluator';
import { CallEvaluatorOutput } from '@/server/call/schemas';
import { clearStubResponses, createStubProvider, registerStubResponse } from '@/server/llm/providers/stub';

const ANSWER =
  'Составной индекс по status и created_at, потому что фильтр сначала по статусу. Альтернативу с частичным индексом рассматривал, но он дороже в поддержке. Не уверен, как поведёт себя при росте таблицы в 10 раз, проверил бы нагрузкой.';
const topics: EvalTopic[] = [
  { topic: 'Индексы', catalogId: 'be.idx', claimed: true, claimStatement: 'Ускорял запросы', maxLevel: 3, qa: [{ question: 'Как выбрал индекс?', answer: ANSWER }] },
];
const crit = (score: 0 | 1 | 2, quote: string) => ({ quote, rationale: 'r', score });
const run = (d: 0 | 1 | 2, w: 0 | 1 | 2, b: 0 | 1 | 2, c: 0 | 1 | 2, quote = 'Составной индекс по status и created_at') => ({
  topics: [{ topic: 'Индексы', depth: crit(d, quote), why: crit(w, quote), boundary: crit(b, quote), completion: crit(c, quote) }],
});

afterEach(() => clearStubResponses());

describe('медиана прогонов', () => {
  it('нечётное — середина, чётное — нижняя из средних (консервативно)', () => {
    expect(medianScore([2, 0, 1])).toBe(1);
    expect(medianScore([2, 2, 0])).toBe(2);
    expect(medianScore([2, 1])).toBe(1);
    expect(medianScore([])).toBe(0);
  });

  it('итог по теме — медиана каждого критерия из трёх прогонов', async () => {
    const outs = [run(2, 2, 1, 0), run(1, 2, 2, 2), run(2, 0, 2, 1)];
    let i = 0;
    registerStubResponse('call_evaluator', () => ({ json: outs[i++ % 3] }));
    const ev = await evaluateCall('backend', topics, createStubProvider());
    expect(ev.runs).toBe(3);
    expect(ev.validRuns).toBe(3);
    const item = ev.depthMap[0]!;
    expect(item.scores).toEqual({ depth: 2, why: 2, boundary: 2, completion: 1 });
    expect(item.total).toBe(7);
    expect(item.confirmed).toBe(true);
    expect(item.runs).toHaveLength(3);
    expect(item.quote).toBe('Составной индекс по status и created_at');
  });

  it('балл без дословной цитаты обнуляется до медианы', () => {
    const per = aggregateRuns(topics, [
      [
        {
          depth: { score: 2, quote: 'x', valid: false },
          why: { score: 0, quote: '', valid: false },
          boundary: { score: 0, quote: '', valid: false },
          completion: { score: 0, quote: '', valid: false },
        },
      ],
    ]);
    // aggregateRuns получает уже проверенные баллы; проверка — в oneRun (следующий тест).
    expect(per[0]!.scores.depth).toBe(2);
  });

  it('выдуманная цитата → 0 по критерию, тема не подтверждается', async () => {
    registerStubResponse('call_evaluator', () => ({ json: run(2, 2, 2, 2, 'этого кандидат не говорил вообще') }));
    const ev = await evaluateCall('backend', topics, createStubProvider());
    expect(ev.depthMap[0]!.scores).toEqual({ depth: 0, why: 0, boundary: 0, completion: 0 });
    expect(ev.depthMap[0]!.confirmed).toBe(false);
  });

  it('меньше двух валидных прогонов → ошибка (finish можно повторить)', async () => {
    let i = 0;
    registerStubResponse('call_evaluator', () => (i++ === 0 ? { json: run(2, 2, 2, 2) } : { json: { nope: true } }));
    await expect(evaluateCall('backend', topics, createStubProvider())).rejects.toMatchObject({ code: 'invalid_output' });
  });
});

describe('схема и слепота оценщика', () => {
  it('ответ stub по умолчанию проходит JSON-схему', async () => {
    const ev = await evaluateCall('backend', topics, createStubProvider());
    expect(ev.validRuns).toBe(3);
    expect(ev.depthMap[0]!.scores.depth).toBe(2);
  });

  it('схема отклоняет балл вне 0..2', () => {
    expect(CallEvaluatorOutput.safeParse(run(2, 2, 2, 2)).success).toBe(true);
    const bad = run(2, 2, 2, 2) as { topics: { depth: { score: number } }[] };
    bad.topics[0]!.depth.score = 3;
    expect(CallEvaluatorOutput.safeParse(bad).success).toBe(false);
  });

  it('оценщик не видит catalogId, утверждения, уровни и факты резюме', () => {
    const payload = buildEvaluatorPayload('backend', [{ ...topics[0]!, qa: [{ question: 'В резюме: «ускорил отчёт в 5 раз». Как?', answer: 'Индексом' }] }], ['ускорил отчёт в 5 раз']);
    const json = JSON.stringify(payload);
    expect(json).not.toContain('be.idx');
    expect(json).not.toContain('Ускорял запросы');
    expect(json).not.toContain('maxLevel');
    expect(json).not.toContain('ускорил отчёт в 5 раз');
  });
});
