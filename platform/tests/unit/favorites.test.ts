import { FavoriteInput, favoriteKind } from '@/server/favorites';

describe('favorites boundary', () => {
  it('maps active roles and rejects pending accounts', () => {
    expect(favoriteKind('candidate')).toBe('vacancy');
    expect(favoriteKind('employer')).toBe('candidate');
    expect(() => favoriteKind('pending')).toThrow('Избранное доступно после выбора роли');
  });
  it('validates target and explicit desired state, rejects owner injection', () => {
    expect(FavoriteInput.safeParse({ kind: 'vacancy', targetId: 'v1', saved: true }).success).toBe(true);
    for (const input of [{ kind: 'vacancy', targetId: 'v1', saved: true, userId: 'other' }, { kind: 'candidate', targetId: '', saved: true }, { kind: 'vacancy', targetId: 'v1' }]) expect(FavoriteInput.safeParse(input).success).toBe(false);
  });
});
