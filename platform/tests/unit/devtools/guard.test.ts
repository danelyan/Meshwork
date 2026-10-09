import { hostnameOf, isDevHostFor } from '@/server/devtools/guard';

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
