import { NextRequest } from 'next/server';

import { config, middleware } from '@/middleware';
import { resetEnvCache } from '@/server/env';
import { SITE_ACCESS_COOKIE, passwordMatches, siteAccessDecision, siteAccessToken } from '@/server/site-access';

const PASSWORD = 'jury-2026';
const base = { password: PASSWORD, host: 'fsp-stars.ru', pathname: '/', cookie: undefined };

describe('site access: пароль на публичный стенд', () => {
  it('без SITE_PASSWORD пропускает всё', () => {
    expect(siteAccessDecision({ ...base, password: undefined })).toBe('allow');
    expect(siteAccessDecision({ ...base, password: undefined, pathname: '/api/me' })).toBe('allow');
  });

  it.each(['localhost', 'localhost:3000', '127.0.0.1:3100', '[::1]:3000'])('%s не закрывается', (host) => {
    expect(siteAccessDecision({ ...base, host })).toBe('allow');
  });

  it.each(['localhost.evil.com', '127.0.0.1.nip.io', 'evil.com:80@localhost', null])('%s закрыт', (host) => {
    expect(siteAccessDecision({ ...base, host })).toBe('redirect');
  });

  it('страницы без куки → на ввод пароля, API → 401', () => {
    expect(siteAccessDecision(base)).toBe('redirect');
    expect(siteAccessDecision({ ...base, pathname: '/employer' })).toBe('redirect');
    expect(siteAccessDecision({ ...base, pathname: '/api/auth/yandex/callback' })).toBe('deny');
  });

  it('открыты проверка живости и сама страница пароля', () => {
    expect(siteAccessDecision({ ...base, pathname: '/api/health' })).toBe('allow');
    expect(siteAccessDecision({ ...base, pathname: '/site-access' })).toBe('allow');
    expect(siteAccessDecision({ ...base, pathname: '/site-access/x' })).toBe('redirect');
  });

  it('кука от верного пароля пускает, от другого или сам пароль — нет', () => {
    expect(siteAccessDecision({ ...base, pathname: '/api/me', cookie: siteAccessToken(PASSWORD) })).toBe('allow');
    expect(siteAccessDecision({ ...base, cookie: siteAccessToken('old-password') })).toBe('redirect');
    expect(siteAccessDecision({ ...base, cookie: PASSWORD })).toBe('redirect');
    expect(siteAccessDecision({ ...base, cookie: '' })).toBe('redirect');
  });

  it('passwordMatches: точное совпадение, любая длина ввода', () => {
    expect(passwordMatches(PASSWORD, PASSWORD)).toBe(true);
    expect(passwordMatches(`${PASSWORD} `, PASSWORD)).toBe(false);
    expect(passwordMatches('', PASSWORD)).toBe(false);
    expect(passwordMatches('x'.repeat(1000), PASSWORD)).toBe(false);
  });
});

describe('middleware', () => {
  const env = { DATABASE_URL: 'postgresql://u@127.0.0.1/db', SESSION_SECRET: 'x'.repeat(32), SITE_PASSWORD: PASSWORD, APP_URL: 'https://fsp-stars.ru' };
  beforeEach(() => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    resetEnvCache();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const request = (url: string, cookie?: string) =>
    new NextRequest(url, {
      headers: { host: 'fsp-stars.ru', ...(cookie ? { cookie: `${SITE_ACCESS_COOKIE}=${cookie}` } : {}) },
    });

  it('страница без куки → 307 на /site-access с next', () => {
    const res = middleware(request('http://0.0.0.0:3000/employer?tab=2'));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get('location') ?? '');
    expect(to.origin).toBe('https://fsp-stars.ru');
    expect(to.pathname).toBe('/site-access');
    expect(to.searchParams.get('next')).toBe('/employer?tab=2');
  });

  it('API без куки → 401 JSON', async () => {
    const res = middleware(request('https://fsp-stars.ru/api/me'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'site_locked', message: 'Стенд закрыт паролем' } });
  });

  it('с кукой доступа пропускает', () => {
    const res = middleware(request('https://fsp-stars.ru/employer', siteAccessToken(PASSWORD)));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('Node.js-рантайм, статика сборки не проходит через гейт', () => {
    expect(config.runtime).toBe('nodejs');
    const re = new RegExp(`^${config.matcher[0]}$`);
    expect(re.test('/_next/static/chunks/a.js')).toBe(false);
    expect(re.test('/assets/logo.svg')).toBe(false);
    expect(re.test('/employer')).toBe(true);
    expect(re.test('/api/me')).toBe(true);
  });
});
