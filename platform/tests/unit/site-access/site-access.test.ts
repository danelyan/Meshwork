import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { NextRequest } from 'next/server';

import { config, middleware } from '@/middleware';
import { resetEnvCache } from '@/server/env';
import { SITE_ACCESS_COOKIE, passwordMatches, siteAccessDecision, siteAccessKey, siteAccessToken } from '@/server/site-access';

const PASSWORD = 'jury-2026';
const SECRET = 's'.repeat(32);
const KEY = siteAccessKey({ SITE_PASSWORD: PASSWORD })!;
const base = { key: KEY, secret: SECRET, host: 'fsp2.ru', pathname: '/', cookie: undefined };

describe('site access: пароль на публичный стенд', () => {
  it('без пароля пропускает всё', () => {
    expect(siteAccessKey({})).toBeUndefined();
    expect(siteAccessDecision({ ...base, key: undefined })).toBe('allow');
    expect(siteAccessDecision({ ...base, key: undefined, pathname: '/api/me' })).toBe('allow');
  });

  it('SITE_PASSWORD_SHA256 = SHA-256 пароля, в любом регистре; важнее SITE_PASSWORD', () => {
    const hex = createHash('sha256').update(PASSWORD).digest('hex');
    expect(KEY).toBe(hex);
    expect(siteAccessKey({ SITE_PASSWORD_SHA256: hex.toUpperCase() })).toBe(hex);
    expect(siteAccessKey({ SITE_PASSWORD: 'other', SITE_PASSWORD_SHA256: hex })).toBe(hex);
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

  it('кука от верного пароля и секрета пускает; от другого пароля, без секрета, сам пароль или хеш – нет', () => {
    expect(siteAccessDecision({ ...base, pathname: '/api/me', cookie: siteAccessToken(KEY, SECRET) })).toBe('allow');
    const oldKey = siteAccessKey({ SITE_PASSWORD: 'old-password' })!;
    expect(siteAccessDecision({ ...base, cookie: siteAccessToken(oldKey, SECRET) })).toBe('redirect');
    expect(siteAccessDecision({ ...base, cookie: siteAccessToken(KEY, 'x'.repeat(32)) })).toBe('redirect');
    expect(siteAccessDecision({ ...base, cookie: PASSWORD })).toBe('redirect');
    expect(siteAccessDecision({ ...base, cookie: KEY })).toBe('redirect');
    expect(siteAccessDecision({ ...base, cookie: '' })).toBe('redirect');
  });

  it('passwordMatches: точное совпадение, любая длина ввода', () => {
    expect(passwordMatches(PASSWORD, KEY)).toBe(true);
    expect(passwordMatches(`${PASSWORD} `, KEY)).toBe(false);
    expect(passwordMatches('', KEY)).toBe(false);
    expect(passwordMatches('x'.repeat(1000), KEY)).toBe(false);
    expect(passwordMatches(KEY, KEY)).toBe(false);
  });
});

describe('middleware', () => {
  const env = {
    DATABASE_URL: 'postgresql://u@127.0.0.1/db',
    SESSION_SECRET: SECRET,
    SITE_PASSWORD_SHA256: KEY,
    APP_URL: 'https://fsp2.ru',
  };
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
      headers: { host: 'fsp2.ru', ...(cookie ? { cookie: `${SITE_ACCESS_COOKIE}=${cookie}` } : {}) },
    });

  it('страница без куки → 307 на /site-access с next', () => {
    const res = middleware(request('http://0.0.0.0:3000/employer?tab=2'));
    expect(res.status).toBe(307);
    const to = new URL(res.headers.get('location') ?? '');
    expect(to.origin).toBe('https://fsp2.ru');
    expect(to.pathname).toBe('/site-access');
    expect(to.searchParams.get('next')).toBe('/employer?tab=2');
  });

  it('API без куки → 401 JSON', async () => {
    const res = middleware(request('https://fsp2.ru/api/me'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: 'site_locked', message: 'Стенд закрыт паролем' } });
  });

  it('с кукой доступа пропускает', () => {
    const res = middleware(request('https://fsp2.ru/employer', siteAccessToken(KEY, SECRET)));
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

  it('страницы /design/* проходят через гейт, файлы public/design/** – нет', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const urlOf = (root: string, file: string) => `/design/${path.relative(root, file).split(path.sep).join('/')}`;

    const appRoot = path.join(process.cwd(), 'src/app/design');
    const pages = walk(appRoot)
      .filter((f) => path.basename(f) === 'page.tsx')
      .map((f) => urlOf(appRoot, path.dirname(f)));
    expect(pages).toEqual(expect.arrayContaining(['/design/avatar', '/design/fonts', '/design/head-motion-preview', '/design/consultant-grid-v1']));
    for (const page of pages) expect(re.test(page), page).toBe(true);
    // Со слэшем на конце и с query (matcher видит только путь) – тоже через гейт.
    for (const page of pages) expect(re.test(`${page}/`), `${page}/`).toBe(true);
    expect(re.test('/design')).toBe(true);

    const publicRoot = path.join(process.cwd(), 'public/design');
    const files = walk(publicRoot).map((f) => urlOf(publicRoot, f));
    expect(files).toContain('/design/consultant-grid-v1/index.html');
    for (const file of files) expect(re.test(file), file).toBe(false);
  });
});
