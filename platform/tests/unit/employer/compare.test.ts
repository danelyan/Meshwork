import { compareCandidates, formatPoints, type CompareSide } from '@/server/employer/compare';

const side = (id: string, over: Partial<Omit<CompareSide, 'boosts'>> & { boosts?: Partial<CompareSide['boosts']> } = {}): CompareSide => {
  const boosts = { category: 0, fsp: 0, stack: 0, specPenalty: 0, ...over.boosts };
  const coverageScore = over.coverageScore ?? 0.5;
  const score = over.score ?? coverageScore + boosts.category + boosts.fsp + boosts.stack + (boosts.project ?? 0) + (boosts.calls ?? 0) - boosts.specPenalty;
  return { candidateId: id, coverageScore, score, boosts };
};

describe('compareCandidates', () => {
  it('раскладывает разницу по факторам и называет главные', () => {
    const a = side('a', { coverageScore: 0.6, boosts: { category: 0.12, fsp: 0.05, stack: 0.06 } });
    const b = side('b', { coverageScore: 0.55, boosts: { category: 0.1, fsp: 0, stack: 0.02 } });
    const r = compareCandidates(a, b);
    expect(r.diff).toBe(16);
    expect(r.factors.find((f) => f.key === 'fsp')).toMatchObject({ a: 5, b: 0, diff: 5 });
    expect(r.factors.find((f) => f.key === 'coverage')?.diff).toBe(5);
    expect(r.advantage).toEqual(['coverage', 'fsp', 'stack']);
    expect(r.factors.reduce((s, f) => s + f.diff, 0)).toBeCloseTo(r.diff, 5);
    expect(r.headline).toMatch(/^Разница \+16,0 п\. в пользу A\. Преимущество: /);
  });

  it('если B выше, лидер - B, разница относительно A отрицательна', () => {
    const r = compareCandidates(side('a'), side('b', { boosts: { fsp: 0.05 } }));
    expect(r.diff).toBe(-5);
    expect(r.headline).toContain('в пользу B');
    expect(r.advantage).toEqual(['fsp']);
  });

  it('равные баллы - без преимущества', () => {
    const r = compareCandidates(side('a'), side('b'));
    expect(r.diff).toBe(0);
    expect(r.advantage).toEqual([]);
    expect(r.headline).toBe('Разница 0 п. Баллы равны.');
  });

  it('штраф за другую специализацию - отрицательный вклад; нулевые у обоих факторы скрыты', () => {
    const r = compareCandidates(side('a'), side('b', { boosts: { specPenalty: 0.2 } }));
    expect(r.factors.map((f) => f.key)).toEqual(['coverage', 'spec']);
    expect(r.factors[1]).toMatchObject({ a: 0, b: -20, diff: 20 });
  });

  it('множитель проверки честности виден отдельной строкой', () => {
    const r = compareCandidates(side('a'), side('b', { score: 0.25 }));
    expect(r.factors.find((f) => f.key === 'integrity')).toMatchObject({ a: 0, b: -25 });
    expect(r.diff).toBe(25);
  });

  it('formatPoints: запятая и настоящий минус', () => {
    expect(formatPoints(6.2)).toBe('+6,2');
    expect(formatPoints(-4.8)).toBe('−4,8');
    expect(formatPoints(0)).toBe('0,0');
  });
});
