import { buildBlockPlan, orderTestBlock, testHintsFrom } from '@/server/interview/context';
import { competenciesFor } from '@/server/interview/model';

describe('контекст ИИнтервью: пометки по тесту и порядок блока «Разбор теста»', () => {
  it('пометки по тесту: задания сопоставляются с компетенциями по catalogIds шаблона', () => {
    const hints = testHintsFrom('backend', [
      { catalogIds: ['be.sql-indexes'], correct: false },
      { catalogIds: ['be.sql-schema', 'be.orm'], correct: true },
      { catalogIds: ['be.cache'], correct: true },
      { catalogIds: ['be.cache'], correct: null },
      { catalogIds: ['fe.a11y'], correct: false },
    ]);
    expect(hints).toEqual(expect.arrayContaining([
      { competencyId: 'backend.data', wrong: 1, right: 1 },
      { competencyId: 'backend.performance', wrong: 0, right: 1 },
    ]));
    expect(hints.some((h) => h.competencyId.startsWith('frontend.'))).toBe(false);
  });

  it('порядок: ядро подкатегории → с ошибками в тесте → верно в тесте → остальные', () => {
    const plan = buildBlockPlan('backend', 'backend.highload', [
      { competencyId: 'backend.security', wrong: 2, right: 0 },
      { competencyId: 'backend.code', wrong: 0, right: 3 },
    ]);
    const ids = plan.test.map((c) => c.id);
    expect(ids[0]).toBe('backend.performance');
    expect(ids[1]).toBe('backend.security');
    expect(ids[2]).toBe('backend.code');
    expect(ids).toHaveLength(competenciesFor('backend').filter((c) => c.axis === 'technical').length);
    expect(plan.systems.map((c) => c.id)).toEqual(['backend.design']);
    expect(plan.intro.map((c) => c.id)).toEqual(['common.context']);
    expect(plan.team.map((c) => c.id)).toEqual(['common.teamwork']);
  });

  it('без подкатегории и теста – порядок модели', () => {
    const tech = competenciesFor('frontend').filter((c) => c.axis === 'technical');
    expect(orderTestBlock(tech, []).map((c) => c.id)).toEqual(tech.map((c) => c.id));
    expect(buildBlockPlan('frontend', null, []).test.map((c) => c.id)).toEqual(tech.map((c) => c.id));
  });
});
