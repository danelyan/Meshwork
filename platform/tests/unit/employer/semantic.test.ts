import { describe, expect, it } from 'vitest';

import { catalogFromFile } from '@/server/claims/catalog-file';
import { compareCandidates } from '@/server/employer/compare';
import { ABLATION_SIGNALS, scoreCandidate, type CandidateEvidence, type MatchTarget } from '@/server/employer/ranking';
import { semanticSignal, textSimilarity } from '@/server/employer/semantic';
import { SEMANTIC_DEFAULT_ON, SEMANTIC_WEIGHT } from '@/server/employer/weights';

const catalog = new Map(catalogFromFile().map((e) => [e.id, e]));
const stmt = (id: string) => catalog.get(id)!.statement;

const target: MatchTarget = {
  specialization: 'backend', grade: 'middle',
  needs: [{ catalogId: 'be.lang-core', weight: 3 }],
  stack: ['PostgreSQL'],
};
// «Postgres» в цитате: точная метка «PostgreSQL» не найдена (matchStack ищет подстроку метки), смежность – по n-граммам.
const cand: CandidateEvidence = {
  id: 'c1', specialization: 'backend', fspState: 'not_linked', category: null,
  claims: [{ catalogId: 'be.lang-core', level: 'artifact', statement: stmt('be.lang-core'), quote: 'Go, Postgres' }],
};

describe('семантический сигнал (смежные навыки)', () => {
  it('пустой текст и пустой профиль – 0', () => {
    expect(textSimilarity('', 'PostgreSQL', catalog)).toBe(0);
    expect(semanticSignal([], target.needs, target.stack, new Set(), [], catalog)).toEqual({ score: 0, matches: [] });
  });

  it('синоним вне каталога («Postgres» при метке «PostgreSQL») поднимает балл и попадает в объяснение', () => {
    const off = scoreCandidate(cand, target, catalog, { semantic: false })!;
    const on = scoreCandidate(cand, target, catalog, { semantic: true })!;
    expect(off.explanation.stackMatched).toEqual([]);
    expect(on.score).toBeGreaterThan(off.score);
    expect(on.boosts.semantic).toBeGreaterThan(0);
    expect(on.boosts.semantic).toBeLessThanOrEqual(SEMANTIC_WEIGHT);
    expect(on.explanation.semantic?.[0]?.need).toBe('PostgreSQL');
    expect(on.explanation.summary).toContain('смежные навыки');
  });

  it('несвязанный текст ниже порога не даёт вклада', () => {
    const r = semanticSignal(cand.claims, [], ['Figma'], new Set(), [], catalog);
    expect(r.score).toBe(0);
  });

  it('выключается абляцией и флагом; дефолт – по замеру eval', () => {
    expect(ABLATION_SIGNALS).toContain('semantic');
    expect(scoreCandidate(cand, target, catalog, { semantic: true, ablate: ['semantic'] })!.boosts.semantic).toBeUndefined();
    expect(scoreCandidate(cand, target, catalog)!.boosts.semantic !== undefined).toBe(SEMANTIC_DEFAULT_ON);
  });

  it('сравнение A/B показывает фактор «Смежные навыки»', () => {
    const on = scoreCandidate(cand, target, catalog, { semantic: true })!;
    const off = scoreCandidate(cand, target, catalog, { semantic: false })!;
    const cmp = compareCandidates(on, { ...off, candidateId: 'c2' });
    const f = cmp.factors.find((x) => x.key === 'semantic');
    expect(f?.label).toBe('Смежные навыки');
    expect(f!.diff).toBeGreaterThan(0);
    expect(cmp.factors.some((x) => x.key === 'integrity')).toBe(false);
  });
});
