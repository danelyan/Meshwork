import { base32Decode, base32Encode, generateTotpSecret, hotp, openTotpSecret, otpauthUri, sealTotpSecret, totpAt, verifyTotp } from '@/server/admin/totp';

// RFC 6238, Appendix B: ключ – ASCII "12345678901234567890" (SHA1), 8 цифр, шаг 30 с, T0 = 0.
const KEY = Buffer.from('12345678901234567890', 'ascii');
const VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (RFC 6238 / RFC 4226)', () => {
  it.each(VECTORS)('вектор RFC 6238: T=%s → %s', (t, code) => {
    expect(totpAt(KEY, t * 1000, 8)).toBe(code);
  });

  it('HOTP RFC 4226, Appendix D: счётчики 0 и 9', () => {
    expect(hotp(KEY, 0)).toBe('755224');
    expect(hotp(KEY, 9)).toBe('520489');
  });

  it('base32 туда-обратно (RFC 4648)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
  });

  it('окно ±1 шаг, шаг за окном и мусор – отказ; возвращает номер шага', () => {
    const secret = base32Encode(KEY);
    const now = 1_700_000_000_000;
    const code = totpAt(KEY, now);
    const step = Math.floor(now / 30_000);
    expect(verifyTotp(secret, code, now)).toBe(step);
    expect(verifyTotp(secret, code, now + 30_000)).toBe(step);
    expect(verifyTotp(secret, code, now - 30_000)).toBe(step);
    expect(verifyTotp(secret, code, now + 90_000)).toBeNull();
    expect(verifyTotp(secret, '12345', now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('секрет в БД зашифрован и не читается чужим ключом', () => {
    const s = generateTotpSecret();
    const sealed = sealTotpSecret(s, 'secret-a');
    expect(sealed).not.toContain(s);
    expect(openTotpSecret(sealed, 'secret-a')).toBe(s);
    expect(openTotpSecret(sealed, 'secret-b')).toBeNull();
    expect(openTotpSecret('garbage', 'secret-a')).toBeNull();
  });

  it('otpauth-URI содержит секрет и параметры', () => {
    const u = new URL(otpauthUri('MZXW6YTBOI', 'a@b.ru'));
    expect(u.protocol).toBe('otpauth:');
    expect(u.searchParams.get('secret')).toBe('MZXW6YTBOI');
    expect(u.searchParams.get('period')).toBe('30');
  });
});
