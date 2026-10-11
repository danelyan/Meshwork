import { AppError } from '@/server/errors';
import { readCookie, requireCandidate, signSession, verifySession } from '@/server/session';

const SECRET = 'x'.repeat(40);
const NOW = 1_800_000_000;

describe('session: подпись куки cid', () => {
  it('подписанный токен проверяется и даёт candidateId', () => {
    const token = signSession('cand_123', SECRET, NOW);
    expect(verifySession(token, SECRET, NOW + 10)).toBe('cand_123');
  });

  it('подмена candidateId ломает подпись', () => {
    const token = signSession('cand_123', SECRET, NOW);
    const forged = token.replace('cand_123', 'cand_999');
    expect(verifySession(forged, SECRET, NOW)).toBeNull();
  });

  it('подмена срока ломает подпись', () => {
    const [id, exp, sig] = signSession('cand_123', SECRET, NOW).split('.');
    expect(verifySession(`${id}.${Number(exp) + 999999}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it('чужой секрет, мусор, пустое – null', () => {
    const token = signSession('cand_123', SECRET, NOW);
    expect(verifySession(token, 'y'.repeat(40), NOW)).toBeNull();
    expect(verifySession('cand_123', SECRET, NOW)).toBeNull();
    expect(verifySession('a.b.c.d', SECRET, NOW)).toBeNull();
    expect(verifySession('', SECRET, NOW)).toBeNull();
    expect(verifySession(undefined, SECRET, NOW)).toBeNull();
  });

  it('истёкший токен – null', () => {
    const token = signSession('cand_123', SECRET, NOW, 60);
    expect(verifySession(token, SECRET, NOW + 59)).toBe('cand_123');
    expect(verifySession(token, SECRET, NOW + 60)).toBeNull();
  });

  it('недопустимый id не подписывается', () => {
    expect(() => signSession('a.b', SECRET, NOW)).toThrow();
    expect(() => signSession('', SECRET, NOW)).toThrow();
  });
});

describe('session: requireCandidate', () => {
  const reqWith = (cookie?: string) => new Request('http://localhost/api/x', { headers: cookie ? { cookie } : {} });

  it('валидная кука → candidateId', () => {
    const token = signSession('cand_1');
    expect(requireCandidate(reqWith(`theme=dark; cid=${token}; other=1`))).toBe('cand_1');
  });

  it('нет куки или подделка → AppError 401 unauthorized', () => {
    for (const cookie of [undefined, 'cid=', 'cid=cand_1.9999999999.AAAA', 'other=1']) {
      try {
        requireCandidate(reqWith(cookie));
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect(err).toMatchObject({ status: 401, code: 'unauthorized' });
      }
    }
  });

  it('readCookie разбирает заголовок', () => {
    expect(readCookie(reqWith('a=1; b=%20x'), 'b')).toBe(' x');
    expect(readCookie(reqWith('a=1'), 'b')).toBeUndefined();
  });
});
