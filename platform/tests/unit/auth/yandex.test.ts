import { safeNext } from '@/server/auth/redirect';
import {
  authorizeUrl,
  pkceChallenge,
  randomToken,
  signOAuthState,
  stateMatches,
  verifyOAuthState,
} from '@/server/auth/yandex';

const SECRET = 'z'.repeat(40);
const NOW = 1_800_000_000;

describe('PKCE', () => {
  it('S256 совпадает с тестовым вектором RFC 7636, приложение B', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('verifier: base64url, длина 43..128, каждый раз новый', () => {
    const v = randomToken(48);
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(randomToken(48)).not.toBe(v);
  });
});

describe('подписанная кука state', () => {
  const s = { state: randomToken(24), verifier: randomToken(48), next: '/profile', consent: 'v1', exp: NOW + 600 };

  it('подпись проверяется, содержимое возвращается', () => {
    expect(verifyOAuthState(signOAuthState(s, SECRET), SECRET, NOW)).toEqual(s);
  });

  it('подмена содержимого, чужой секрет, истёкший срок, мусор – null', () => {
    const t = signOAuthState(s, SECRET);
    const [payload, sig] = t.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...s, next: 'https://evil.example' })).toString('base64url');
    expect(verifyOAuthState(`${forged}.${sig}`, SECRET, NOW)).toBeNull();
    expect(verifyOAuthState(`${payload}.${sig}`, 'q'.repeat(40), NOW)).toBeNull();
    expect(verifyOAuthState(t, SECRET, NOW + 600)).toBeNull();
    expect(verifyOAuthState('a.b.c', SECRET, NOW)).toBeNull();
    expect(verifyOAuthState(undefined, SECRET, NOW)).toBeNull();
  });

  it('кука сессии не проходит как кука state (разные контексты подписи)', () => {
    expect(verifyOAuthState('demo-a.1900000000.AAAA', SECRET, NOW)).toBeNull();
  });

  it('stateMatches: точное совпадение', () => {
    expect(stateMatches('abc', 'abc')).toBe(true);
    expect(stateMatches('abc', 'abd')).toBe(false);
    expect(stateMatches('abc', 'ab')).toBe(false);
    expect(stateMatches('abc', null)).toBe(false);
  });
});

describe('authorizeUrl', () => {
  it('code + state + PKCE S256 + scope + точный redirect_uri', () => {
    const u = new URL(authorizeUrl({ clientId: 'cid1', clientSecret: 's', redirectUri: 'http://localhost:3000/api/auth/yandex/callback' }, 'st', 'v'.repeat(43)));
    expect(u.origin + u.pathname).toBe('https://oauth.yandex.ru/authorize');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'cid1',
      redirect_uri: 'http://localhost:3000/api/auth/yandex/callback',
      scope: 'login:info login:email',
      state: 'st',
      code_challenge: pkceChallenge('v'.repeat(43)),
      code_challenge_method: 'S256',
    });
    expect(u.searchParams.has('client_secret')).toBe(false);
  });
});

describe('safeNext (open redirect)', () => {
  it.each([
    ['/profile', '/profile'],
    ['/defense/abc?x=1#h', '/defense/abc?x=1#h'],
  ])('пропускает %s', (raw, out) => expect(safeNext(raw)).toBe(out));

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', 'profile', '/api/auth/logout', '/\tevil', '', null, undefined, `/${'a'.repeat(600)}`])(
    'отсекает %s',
    (raw) => expect(safeNext(raw as string | null | undefined)).toBeNull(),
  );
});
