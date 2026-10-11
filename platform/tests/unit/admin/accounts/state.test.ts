import { isBlockedNow } from '@/server/admin/accounts/state';
import { passwordVersionOf, sessionVersionOf } from '@/server/auth/password-version';

describe('E-08 фаза 3: состояние блокировки и версия сессии', () => {
  const now = new Date('2026-10-11T12:00:00Z');

  it('isBlockedNow: нет blockedAt — нет; бессрочно — да; срок в будущем — да; срок прошёл (или разблокирован) — нет', () => {
    expect(isBlockedNow(null, now)).toBe(false);
    expect(isBlockedNow({ blockedAt: null, blockedUntil: null }, now)).toBe(false);
    expect(isBlockedNow({ blockedAt: now, blockedUntil: null }, now)).toBe(true);
    expect(isBlockedNow({ blockedAt: now, blockedUntil: new Date(now.getTime() + 1000) }, now)).toBe(true);
    expect(isBlockedNow({ blockedAt: now, blockedUntil: now }, now)).toBe(false);
  });

  it('sessionVersionOf: без блокировки — как passwordVersionOf (старые куки живы); блокировка меняет версию и у аккаунта без пароля', () => {
    expect(sessionVersionOf({ passwordHash: 'scrypt$h', blockedAt: null })).toBe(passwordVersionOf('scrypt$h'));
    expect(sessionVersionOf({ passwordHash: null })).toBe('');
    const b1 = sessionVersionOf({ passwordHash: null, blockedAt: now });
    expect(b1).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(sessionVersionOf({ passwordHash: 'scrypt$h', blockedAt: now })).not.toBe(passwordVersionOf('scrypt$h'));
    // Повторная блокировка — новая эпоха, новая версия.
    expect(sessionVersionOf({ passwordHash: null, blockedAt: new Date(now.getTime() + 1) })).not.toBe(b1);
  });
});
