import { hostnameOf, isDevHostFor, isDevRequest } from '@/server/devtools/guard';
import { getEnv, parseEnv, resetEnvCache } from '@/server/env';

describe('devtools guard: только localhost', () => {
  const dev = { NODE_ENV: 'development' };

  it('hostnameOf: порт отбрасывается, IPv6 в скобках', () => {
    expect(hostnameOf('localhost:3016')).toBe('localhost');
    expect(hostnameOf('LOCALHOST')).toBe('localhost');
    expect(hostnameOf('[::1]:3000')).toBe('[::1]');
    expect(hostnameOf('[::1')).toBeNull();
    expect(hostnameOf('')).toBeNull();
    expect(hostnameOf(null)).toBeNull();
  });

  it.each(['localhost', 'localhost:3016', '127.0.0.1', '127.0.0.1:3000', '[::1]', '[::1]:8080'])('%s → включено', (h) => {
    expect(isDevHostFor(h, dev)).toBe(true);
    expect(isDevHostFor(h, { NODE_ENV: 'test' })).toBe(true);
  });

  it.each(['fsp.example.ru', 'localhost.evil.com', '127.0.0.1.nip.io', '192.168.1.5:3000', '0.0.0.0', 'evil.com:80@localhost', '', null, undefined])(
    '%s → выключено',
    (h) => {
      expect(isDevHostFor(h as string | null | undefined, dev)).toBe(false);
    },
  );

  it('production выключает даже на localhost', () => {
    expect(isDevHostFor('localhost:3000', { NODE_ENV: 'production' })).toBe(false);
    expect(isDevHostFor('127.0.0.1', { NODE_ENV: 'production', DEVTOOLS: 'true' })).toBe(false);
  });

  it.each(['false', 'FALSE', '0', 'off'])('DEVTOOLS=%s выключает всегда', (v) => {
    expect(isDevHostFor('localhost', { ...dev, DEVTOOLS: v })).toBe(false);
  });

  it('DEVTOOLS=true или не задан — не мешает', () => {
    expect(isDevHostFor('localhost', { ...dev, DEVTOOLS: 'true' })).toBe(true);
    expect(isDevHostFor('localhost', {})).toBe(true);
  });
});

describe('devtools guard: DEVTOOLS — через схему окружения (env.ts)', () => {
  const base = { DATABASE_URL: 'postgresql://x@localhost/db', SESSION_SECRET: 'x'.repeat(32) };
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it.each(['false', 'FALSE', ' 0 ', 'off'])('схема: DEVTOOLS=%s → выключено', (v) => {
    expect(parseEnv({ ...base, DEVTOOLS: v }).DEVTOOLS).toBe(false);
  });

  it.each([undefined, '', 'true', '1', 'on', 'maybe'])('схема: DEVTOOLS=%s → включено, запуск не падает', (v) => {
    expect(parseEnv({ ...base, DEVTOOLS: v }).DEVTOOLS).toBe(true);
  });

  it('без явного env выключатель читается из getEnv(), а не из process.env', () => {
    const req = new Request('http://localhost:3000/api/dev/x');
    expect(isDevHostFor('localhost')).toBe(true);
    expect(isDevRequest(req)).toBe(true);

    vi.stubEnv('DEVTOOLS', 'false');
    resetEnvCache();
    expect(getEnv().DEVTOOLS).toBe(false);
    expect(isDevHostFor('localhost')).toBe(false);
    expect(isDevRequest(req)).toBe(false);

    // Окружение проверяется один раз: правка process.env после этого решение не меняет.
    vi.stubEnv('DEVTOOLS', 'true');
    expect(isDevHostFor('localhost')).toBe(false);
    resetEnvCache();
    expect(isDevHostFor('localhost')).toBe(true);
  });

  it('production: выключено до обращения к схеме окружения', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SESSION_SECRET', '');
    resetEnvCache();
    expect(isDevHostFor('localhost')).toBe(false);
  });
});
