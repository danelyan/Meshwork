import type { AnswerSignal } from '@/server/call/types';
import { buildBlockPlan } from '@/server/interview/context';
import { INTERVIEW_LIMITS, type InterviewTurn, blockCounts, clarificationHint, currentBlock, planInterviewNext, stageOf, templateInterviewQuestion } from '@/server/interview/plan';

const plan = buildBlockPlan('backend', 'backend.web-api', []);

/** Прогон интервью с заданной последовательностью сигналов: возвращает ходы до done. */
function run(signals: AnswerSignal[] | AnswerSignal, grade: 'junior' | 'middle' | 'senior' = 'middle'): InterviewTurn[] {
  const turns: InterviewTurn[] = [];
  for (let i = 0; i < 20; i++) {
    const signal = turns.length === 0 ? null : Array.isArray(signals) ? (signals[turns.length - 1] ?? 'none') : signals;
    const p = planInterviewNext({ plan, turns, grade, signal });
    if (p.done) break;
    turns.push({ question: `q${i}`, answer: 'a', competencyId: p.competency.id, block: p.block, level: p.level });
  }
  return turns;
}

describe('план ИИнтервью: блоки по порядку, маршрут по уровню', () => {
  it('первый вопрос – знакомство на уровне грейда', () => {
    const p = planInterviewNext({ plan, turns: [], grade: 'middle', signal: null });
    expect(p.block).toBe('intro');
    expect(p.competency.id).toBe('common.context');
    expect(p.level).toBe(2);
    expect(p.done).toBe(false);
  });

  it('после знакомства – разбор теста с ядра подкатегории; сильные ответы углубляют ту же компетенцию', () => {
    const turns = run('strong');
    expect(turns[1]!.block).toBe('test');
    expect(turns[1]!.competencyId).toBe('backend.code');
    expect(turns[1]!.level).toBe(2);
    expect(turns[2]).toMatchObject({ block: 'test', competencyId: 'backend.code', level: 3 });
    // Не больше двух вопросов на компетенцию → третий вопрос блока по другой компетенции.
    expect(turns[3]!.block).toBe('test');
    expect(turns[3]!.competencyId).not.toBe('backend.code');
  });

  it('слабые ответы: по одному вопросу на блок по минимуму, новая компетенция на уровень проще', () => {
    const turns = run('weak');
    expect(turns.map((t) => t.block)).toEqual(['intro', 'test', 'test', 'systems', 'team']);
    expect(turns[2]!.level).toBe(1);
    expect(turns[2]!.competencyId).not.toBe(turns[1]!.competencyId);
    expect(turns).toHaveLength(INTERVIEW_LIMITS.minQuestions);
  });

  it('сильные ответы: не больше максимума, все блоки пройдены, каждой компетенции ≤ 2 вопроса', () => {
    const turns = run('strong');
    expect(turns.length).toBeLessThanOrEqual(INTERVIEW_LIMITS.maxQuestions);
    expect(turns.length).toBeGreaterThanOrEqual(INTERVIEW_LIMITS.minQuestions);
    const counts = blockCounts(turns);
    expect(counts.intro).toBe(1);
    expect(counts.team).toBe(1);
    expect(counts.systems).toBeGreaterThanOrEqual(1);
    expect(counts.test).toBeGreaterThanOrEqual(2);
    const per = new Map<string, number>();
    for (const t of turns) per.set(t.competencyId, (per.get(t.competencyId) ?? 0) + 1);
    for (const n of per.values()) expect(n).toBeLessThanOrEqual(INTERVIEW_LIMITS.maxPerCompetency);
    expect(planInterviewNext({ plan, turns, grade: 'middle', signal: 'strong' }).done).toBe(true);
  });

  it('углубление блока не отбирает вопросы у минимумов следующих блоков', () => {
    for (const grade of ['junior', 'middle', 'senior'] as const) {
      for (const seq of [['strong', 'strong', 'strong', 'strong', 'weak', 'strong'], ['none', 'strong', 'weak', 'strong', 'strong']] as AnswerSignal[][]) {
        const turns = run(seq, grade);
        const counts = blockCounts(turns);
        expect(counts.systems).toBeGreaterThanOrEqual(1);
        expect(counts.team).toBe(1);
      }
    }
  });

  it('дополнительные вопросы (probe) не считаются в блоках и не двигают этап', () => {
    const turns = run('weak');
    const withProbe: InterviewTurn[] = [...turns, { question: 'ещё', answer: 'a', competencyId: 'backend.code', block: 'test', level: 2, probe: true }];
    expect(blockCounts(withProbe)).toEqual(blockCounts(turns));
    expect(currentBlock(withProbe)).toBe('team');
    expect(stageOf(withProbe, true)).toBe('summary');
    expect(stageOf([], false)).toBe('intro');
  });

  it('шаблон вопроса – по фокусу компетенции на уровне, первый – с приветствием', () => {
    const c = plan.test[0]!;
    const q = templateInterviewQuestion(c, 'test', 2, true);
    expect(q).toMatch(/^Привет/);
    expect(q.toLowerCase()).toContain(c.focus.middle.slice(1, 20).toLowerCase());
    expect(templateInterviewQuestion(plan.intro[0]!, 'intro', 1, false)).not.toMatch(/^Привет/);
    expect(templateInterviewQuestion(plan.systems[0]!, 'systems', 3, false)).toContain(plan.systems[0]!.focus.senior);
  });
});

describe('подсказка «Уточнить вопрос» – клиентская, по фокусу компетенции', () => {
  it('содержит название компетенции и фокус уровня, не является ответом', () => {
    const c = plan.test[0]!;
    const h = clarificationHint(c, 2);
    expect(h).toContain(c.title.toLowerCase());
    expect(h.toLowerCase()).toContain(c.focus.middle.slice(1, 25).toLowerCase());
    expect(clarificationHint(c, 3)).toContain('альтернативы');
    expect(clarificationHint(c, 1)).toContain('пример');
  });
});
