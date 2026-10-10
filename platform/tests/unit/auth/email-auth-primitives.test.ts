import { CODE_TTL_MS, generateCode, hashCode } from '@/server/auth/codes';
import { hashPassword, verifyPassword } from '@/server/auth/password';
import { hit, resetRateLimits } from '@/server/auth/rate-limit';

describe('пароль: scrypt', () => {
  it('хэш с солью: разные строки для одного пароля, проверка проходит только верным паролем', async () => {
    const a = await hashPassword('correct horse');
    const b = await hashPassword('correct horse');
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(a).not.toBe(b);
    expect(await verifyPassword('correct horse', a)).toBe(true);
    expect(await verifyPassword('correct horsE', a)).toBe(false);
    expect(await verifyPassword('', a)).toBe(false);
  });

  it('битая или чужая строка хэша — false, без исключения', async () => {
    expect(await verifyPassword('x', 'bcrypt$whatever')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$abc$8$1$c2FsdA$aGFzaA')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$16384$8$1$$')).toBe(false);
  });
});

describe('одноразовые коды', () => {
  it('6 цифр с ведущими нулями', () => {
    for (let i = 0; i < 200; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  it('хэш зависит от назначения, пользователя и секрета; срок — 15 минут', () => {
    const base = hashCode('123456', 'verify', 'u1', 's'.repeat(32));
    expect(hashCode('123456', 'verify', 'u1', 's'.repeat(32))).toBe(base);
    expect(hashCode('123456', 'reset', 'u1', 's'.repeat(32))).not.toBe(base);
    expect(hashCode('123456', 'verify', 'u2', 's'.repeat(32))).not.toBe(base);
    expect(hashCode('123456', 'verify', 'u1', 't'.repeat(32))).not.toBe(base);
    expect(base).not.toContain('123456');
    expect(CODE_TTL_MS).toBe(15 * 60_000);
  });
});

describe('ограничитель частоты', () => {
  beforeEach(() => resetRateLimits());

  it('пускает limit событий в окне, дальше отказ; новое окно — снова пускает', () => {
    const rule = { limit: 3, windowMs: 1000 };
    expect([1, 2, 3].map(() => hit('k', rule, 0))).toEqual([true, true, true]);
    expect(hit('k', rule, 500)).toBe(false);
    expect(hit('other', rule, 500)).toBe(true);
    expect(hit('k', rule, 1000)).toBe(true);
  });
});
