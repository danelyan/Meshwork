import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { AppError } from '@/server/errors';
import {
  checkUrl,
  checkUrlSyntax,
  classifyIpLiteral,
  parseIPv4,
  parseIPv6,
  type CheckedTarget,
  type Resolver,
} from '@/server/collector/ssrf';
import { createUrlFetcher, undiciGet, type HttpGet, type HttpResponse } from '@/server/collector/url';

interface EvalUrl {
  url: string;
  blocked: boolean;
  category: string;
  requiresDns?: boolean;
  fixture?: { redirectChain: string[] };
}
const DATASET = JSON.parse(readFileSync(path.join(process.cwd(), 'eval/ssrf/urls.json'), 'utf8')) as { urls: EvalUrl[] };

// Подставной DNS: публичные имена → публичные адреса, «обёртки» → внутренние.
const DNS: Record<string, string[]> = {
  'github.com': ['140.82.121.4'],
  'codeforces.com': ['213.248.110.126'],
  'stackoverflow.com': ['198.252.206.16'],
  'example.com': ['93.184.215.14', '2606:2800:21f:cb07:6820:80da:af6b:8b2c'],
  'example.org': ['93.184.215.14'],
  'public.example.net': ['93.184.215.15'],
  'hop.example.net': ['93.184.215.16'],
  '169.254.169.254.nip.io': ['169.254.169.254'],
  '127.0.0.1.nip.io': ['127.0.0.1'],
  'localtest.me': ['127.0.0.1'],
  'mixed.example.net': ['93.184.215.17', '10.0.0.5'],
  'v6private.example.net': ['fd00::1'],
  'mapped.example.net': ['::ffff:10.0.0.1'],
};
const resolver: Resolver = async (host) => {
  const a = DNS[host];
  if (!a) throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' });
  return a.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
};

async function errorOf(p: Promise<unknown>): Promise<AppError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e, 'ожидалась ошибка').toBeInstanceOf(AppError);
  return e as AppError;
}

function htmlResponse(html: string, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', ...headers },
    body: (async function* () {
      yield Buffer.from(html);
    })(),
    discard: async () => undefined,
  };
}
const redirect = (location: string): HttpResponse => ({ ...htmlResponse('', 302, { location }) });

/** Подставной HTTP: цепочка редиректов из fixture, затем 200. Запоминает, куда «соединялись». */
function chainHttp(chain: string[], finalHtml = '<p>ok</p>') {
  const calls: CheckedTarget[] = [];
  const get: HttpGet = async (target) => {
    calls.push(target);
    const i = calls.length - 1;
    return i < chain.length ? redirect(chain[i]!) : htmlResponse(finalHtml);
  };
  return { get, calls };
}

describe('collector/ssrf: весь eval/ssrf/urls.json', () => {
  const blocked = DATASET.urls.filter((u) => u.blocked);
  const allowed = DATASET.urls.filter((u) => !u.blocked);

  it('набор не пустой', () => {
    expect(blocked.length).toBeGreaterThanOrEqual(30);
    expect(allowed.length).toBeGreaterThanOrEqual(5);
  });

  it.each(blocked.map((u) => [u.url, u]))('blocked: %s → blocked_url, без сетевого запроса', async (_url, u) => {
    const { get, calls } = chainHttp(u.fixture?.redirectChain ?? []);
    const fetchUrl = createUrlFetcher({ resolve: resolver, httpGet: get });
    const err = await errorOf(fetchUrl(u.url));
    expect(err.code).toBe('blocked_url');
    // к внутреннему адресу соединения не было ни разу
    for (const c of calls) expect(classifyIpLiteral(c.address)?.blocked).toBe(false);
  });

  it.each(allowed.map((u) => [u.url]))('public: %s → проходит проверку и читается', async (url) => {
    const target = await checkUrl(url, resolver);
    expect(classifyIpLiteral(target.address)?.blocked).toBe(false);
    const { get, calls } = chainHttp([], '<title>T</title><p>Публичная страница</p>');
    const doc = await createUrlFetcher({ resolve: resolver, httpGet: get })(url);
    expect(doc.text).toBe('Публичная страница');
    expect(doc.sourceKind).toBe('url');
    expect(calls).toHaveLength(1);
  });
});

describe('collector/ssrf: нормализация адресов', () => {
  it.each([
    ['127.1', '127.0.0.1'],
    ['0x7f000001', '127.0.0.1'],
    ['2130706433', '127.0.0.1'],
    ['0177.0.0.1', '127.0.0.1'],
    ['0x7f.0.0.1', '127.0.0.1'],
    ['10.1', '10.0.0.1'],
    ['0', '0.0.0.0'],
  ])('IPv4 %s = %s', (raw, ip) => {
    const v = parseIPv4(raw);
    expect(classifyIpLiteral(raw)).toEqual({ ip, family: 4, blocked: true });
    expect(v).not.toBeNull();
  });

  it.each(['256.1.1.1', '1.2.3.4.5', 'abc', '08.1.1.1', '1..1'])('не IPv4: %s', (raw) => {
    expect(parseIPv4(raw)).toBeNull();
  });

  it.each([
    ['::1', true],
    ['::', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:7f00:1', true],
    ['::ffff:8.8.8.8', false],
    ['::127.0.0.1', true],
    ['fd00::1', true],
    ['fc00::1', true],
    ['fe80::1', true],
    ['fe80::1%25eth0', true],
    ['ff02::1', true],
    ['64:ff9b::a00:1', true],
    ['2002:7f00:1::1', true],
    ['2001:db8::1', true],
    ['2001:0:4136:e378::1', true],
    ['2606:4700:4700::1111', false],
    ['2a00:1450:4010:c05::64', false],
  ])('IPv6 %s blocked=%s', (raw, blocked) => {
    expect(parseIPv6(raw.replace('%25', '%'))).not.toBeNull();
    expect(classifyIpLiteral(raw.replace('%25', '%'))?.blocked).toBe(blocked);
  });

  it.each([
    ['8.8.8.8', false],
    ['100.63.255.255', false],
    ['100.64.0.0', true],
    ['100.127.255.255', true],
    ['172.15.255.255', false],
    ['172.32.0.0', false],
    ['192.169.0.1', false],
    ['198.18.0.1', true],
    ['224.0.0.1', true],
    ['239.255.255.250', true],
    ['255.255.255.255', true],
    ['169.254.169.254', true],
  ])('IPv4 %s blocked=%s', (raw, blocked) => {
    expect(classifyIpLiteral(raw)?.blocked).toBe(blocked);
  });
});

describe('collector/ssrf: синтаксис и имена', () => {
  it.each([
    'http://intranet/',
    'http://db.internal/',
    'http://printer.local/',
    'http://app.localhost/',
    'http://LOCALHOST./',
    'http://example.com:22/',
    'http://example.com:6379/',
    'https://u@example.com/',
    'http://exa\\mple.com/',
    'http://exa\nmple.com/',
    `http://example.com/${'a'.repeat(3000)}`,
    'not a url',
    '',
  ])('blocked: %j', (url) => {
    expect(() => checkUrlSyntax(url)).toThrowError(AppError);
  });

  it.each(['https://example.com/', 'http://example.com:8080/x', 'https://example.com:443/'])('ok: %s', (url) => {
    expect(() => checkUrlSyntax(url)).not.toThrow();
  });

  it('фрагмент отбрасывается', () => {
    expect(checkUrlSyntax('https://example.com/a#frag').url.href).toBe('https://example.com/a');
  });
});

describe('collector/ssrf: DNS и пиннинг', () => {
  it('хотя бы один внутренний адрес в ответе DNS → blocked', async () => {
    expect((await errorOf(checkUrl('https://mixed.example.net/', resolver))).code).toBe('blocked_url');
    expect((await errorOf(checkUrl('https://v6private.example.net/', resolver))).code).toBe('blocked_url');
    expect((await errorOf(checkUrl('https://mapped.example.net/', resolver))).code).toBe('blocked_url');
  });

  it('неизвестное имя → fetch_failed', async () => {
    expect((await errorOf(checkUrl('https://nope.example.net/', resolver))).code).toBe('fetch_failed');
  });

  it('DNS-rebinding: соединение идёт на адрес, проверенный при резолве, второй резолв не делается', async () => {
    let n = 0;
    const flipping: Resolver = async () => [{ address: n++ === 0 ? '93.184.215.20' : '127.0.0.1', family: 4 }];
    const { get, calls } = chainHttp([]);
    await createUrlFetcher({ resolve: flipping, httpGet: get })('https://rebind.example.net/');
    expect(n).toBe(1);
    expect(calls[0]!.address).toBe('93.184.215.20');
  });
});

describe('collector/url: редиректы', () => {
  it('редирект на публичный хост: проверка заново, итоговый URL в origin', async () => {
    const { get, calls } = chainHttp(['https://hop.example.net/b'], '<p>final</p>');
    const doc = await createUrlFetcher({ resolve: resolver, httpGet: get })('https://public.example.net/a');
    expect(calls.map((c) => c.address)).toEqual(['93.184.215.15', '93.184.215.16']);
    expect(doc.origin).toBe('https://hop.example.net/b');
    expect(doc.meta?.requestedUrl).toBe('https://public.example.net/a');
  });

  it.each([
    ['http://127.0.0.1/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://[::ffff:127.0.0.1]/'],
    ['http://localtest.me/'],
    ['file:///etc/passwd'],
    ['/relative-is-same-host-ok'],
  ])('редирект с публичного на %s', async (loc) => {
    const { get, calls } = chainHttp([loc]);
    const fetchUrl = createUrlFetcher({ resolve: resolver, httpGet: get });
    if (loc.startsWith('/')) {
      await expect(fetchUrl('https://public.example.net/a')).resolves.toBeTruthy();
      expect(calls).toHaveLength(2);
    } else {
      expect((await errorOf(fetchUrl('https://public.example.net/a'))).code).toBe('blocked_url');
      expect(calls).toHaveLength(1);
    }
  });

  it('3 редиректа можно, 4-й – blocked_url', async () => {
    const hops = (k: number) => Array.from({ length: k }, (_, i) => `https://hop.example.net/${i}`);
    const ok = chainHttp(hops(3));
    await expect(createUrlFetcher({ resolve: resolver, httpGet: ok.get })('https://public.example.net/')).resolves.toBeTruthy();
    const tooMany = chainHttp(hops(4));
    const err = await errorOf(createUrlFetcher({ resolve: resolver, httpGet: tooMany.get })('https://public.example.net/'));
    expect(err.code).toBe('blocked_url');
    expect(tooMany.calls).toHaveLength(4);
  });
});

describe('collector/url: ответ', () => {
  const fetcher = (res: () => HttpResponse, extra = {}) =>
    createUrlFetcher({ resolve: resolver, httpGet: async () => res(), ...extra });

  it.each(['application/json', 'image/png', 'application/octet-stream', ''])('тип %j → 415', async (ct) => {
    const err = await errorOf(fetcher(() => htmlResponse('{}', 200, { 'content-type': ct }))('https://example.com/'));
    expect(err.code).toBe('unsupported_media_type');
  });

  it('картинка по ссылке → 415 с просьбой прикрепить файлом (OCR по ссылкам не вызываем)', async () => {
    const err = await errorOf(fetcher(() => htmlResponse('x', 200, { 'content-type': 'image/jpeg' }))('https://example.com/cv.jpg'));
    expect(err.code).toBe('unsupported_media_type');
    expect(err.message).toMatch(/прикрепи файлом JPG или PNG/);
  });

  it('text/plain → строки с ref url#lN', async () => {
    const doc = await fetcher(() => htmlResponse('a\n\nb', 200, { 'content-type': 'text/plain' }))('https://example.com/x.txt');
    expect(doc.lines).toEqual([
      { ref: 'https://example.com/x.txt#l1', text: 'a' },
      { ref: 'https://example.com/x.txt#l3', text: 'b' },
    ]);
  });

  it('404 → fetch_failed', async () => {
    expect((await errorOf(fetcher(() => htmlResponse('', 404))('https://example.com/'))).code).toBe('fetch_failed');
  });

  it('тело больше лимита: html усечён с флагом, по content-length – сразу', async () => {
    const big = `<p>${'a'.repeat(5000)}</p>`;
    const doc = await fetcher(() => htmlResponse(big), { maxBytes: 1000 })('https://example.com/');
    expect(doc.flags.truncated).toBe(true);
    const declared = await fetcher(() => htmlResponse('<p>x</p>', 200, { 'content-length': String(10 * 1024 * 1024) }))(
      'https://example.com/',
    );
    expect(declared.flags.truncated).toBe(true);
    expect(declared.text).toBe('');
  });

  it('PDF больше лимита → 413', async () => {
    const res = () => ({ ...htmlResponse('%PDF-1.4 ' + 'x'.repeat(2000), 200, { 'content-type': 'application/pdf' }) });
    expect((await errorOf(fetcher(res, { maxBytes: 1000 })('https://example.com/cv.pdf'))).code).toBe('payload_too_large');
  });

  it('cp1251 по charset', async () => {
    const body = Buffer.from([0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2]); // «Привет»
    const res = (): HttpResponse => ({
      status: 200,
      headers: { 'content-type': 'text/html; charset=windows-1251' },
      body: (async function* () {
        yield body;
      })(),
      discard: async () => undefined,
    });
    expect((await fetcher(res)('https://example.com/')).text).toBe('Привет');
  });
});

describe('collector/url: настоящий undici – пиннинг адреса, лимит, таймаут', () => {
  let server: Server;
  let port = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/slow') return void setTimeout(() => res.end('late'), 2000);
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' });
        const chunk = Buffer.alloc(64 * 1024, 'a');
        let sent = 0;
        const push = () => {
          while (sent < 50 && res.write(chunk)) sent++;
          if (sent < 50) res.once('drain', push);
          else res.end();
        };
        return push();
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<p>host=${req.headers.host}</p>`);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  // Подменяем только адрес/порт соединения: имя хоста в URL – несуществующее публичное.
  const pinnedToLocal: HttpGet = (target, signal) => {
    const url = new URL(target.url);
    url.port = String(port);
    return undiciGet({ ...target, url, address: '127.0.0.1', family: 4 }, signal);
  };

  it('соединение идёт на запиненный IP, Host – исходное имя', async () => {
    const fetchUrl = createUrlFetcher({ resolve: resolver, httpGet: pinnedToLocal });
    const doc = await fetchUrl('http://public.example.net/');
    expect(doc.text).toBe(`host=public.example.net:${port}`);
  });

  it('поток режется на лимите', async () => {
    const fetchUrl = createUrlFetcher({ resolve: resolver, httpGet: pinnedToLocal, maxBytes: 100_000 });
    const doc = await fetchUrl('http://public.example.net/big');
    expect(doc.flags.truncated).toBe(true);
  });

  it('таймаут → fetch_failed 504', async () => {
    const fetchUrl = createUrlFetcher({ resolve: resolver, httpGet: pinnedToLocal, timeoutMs: 300 });
    const err = await errorOf(fetchUrl('http://public.example.net/slow'));
    expect(err.code).toBe('fetch_failed');
    expect(err.status).toBe(504);
  });
});
