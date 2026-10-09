import { LEVEL_ORDER, LEVELS_TOP_DOWN, levelRank, maxLevelFor, PLATFORM_UPGRADABLE } from '@/server/claims/levels';
import { bestLevel, LEVEL_WEIGHT } from '@/server/recommend/weights';
import type { SourceKind } from '@/server/collector/types';

describe('maxLevelFor (ADR-0001)', () => {
  it.each<[SourceKind, string]>([
    ['resume', 'self_reported'],
    ['document', 'self_reported'],
    ['chat', 'self_reported'],
    ['github', 'artifact'],
    ['url', 'artifact'],
    ['stackoverflow', 'artifact'],
    ['codeforces', 'artifact'],
    ['fsp', 'artifact'],
  ])('%s → %s без подтверждённого владения', (kind, level) => {
    expect(maxLevelFor(kind)).toBe(level);
    expect(maxLevelFor(kind, { ownershipVerified: false })).toBe(level);
  });

  it('codeforces и fsp → third_party только при ownershipVerified', () => {
    expect(maxLevelFor('codeforces', { ownershipVerified: true })).toBe('third_party');
    expect(maxLevelFor('fsp', { ownershipVerified: true })).toBe('third_party');
  });

  it('владение не поднимает резюме и GitHub', () => {
    expect(maxLevelFor('resume', { ownershipVerified: true })).toBe('self_reported');
    expect(maxLevelFor('github', { ownershipVerified: true })).toBe('artifact');
  });

  it('platform не выдаётся ни для одного источника', () => {
    const kinds: SourceKind[] = ['resume', 'document', 'url', 'github', 'codeforces', 'stackoverflow', 'fsp', 'chat'];
    for (const k of kinds) for (const o of [true, false]) expect(maxLevelFor(k, { ownershipVerified: o })).not.toBe('platform');
  });

  it('неизвестный kind из БД → самый низкий уровень', () => {
    expect(maxLevelFor('telegram' as SourceKind, { ownershipVerified: true })).toBe('self_reported');
  });

  it('порядок уровней (решение 09.10): платформа выше третьей стороны', () => {
    expect(LEVEL_ORDER).toEqual(['self_reported', 'artifact', 'third_party', 'platform']);
    expect(levelRank('platform')).toBeGreaterThan(levelRank('third_party'));
    expect(LEVELS_TOP_DOWN).toEqual(['platform', 'third_party', 'artifact', 'self_reported']);
  });

  it('производные от порядка: веса покрытия, лучший уровень, кого поднимают тест и защита', () => {
    expect(LEVEL_WEIGHT).toEqual({ self_reported: 0.25, artifact: 0.5, third_party: 0.75, platform: 1 });
    expect(bestLevel(['third_party', 'platform', 'artifact'])).toBe('platform');
    expect(bestLevel(['self_reported', 'third_party'])).toBe('third_party');
    expect([...PLATFORM_UPGRADABLE].sort()).toEqual(['artifact', 'self_reported', 'third_party']);
  });
});
