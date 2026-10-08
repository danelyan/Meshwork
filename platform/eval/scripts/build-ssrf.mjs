// Генерация ssrf/urls.json. Запуск: node scripts/build-ssrf.mjs
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const b = (category, url, note, extra = {}) => ({ url, blocked: true, category, note, ...extra });
const ok = (url, note) => ({ url, blocked: false, category: 'public', note });
const urls = [
  b('loopback', 'http://localhost/', 'имя localhost'),
  b('loopback', 'http://localhost:8080/admin', 'localhost с портом'),
  b('loopback', 'http://127.0.0.1/', 'IPv4 loopback'),
  b('loopback-encoded', 'http://127.1/', 'сокращённая запись'),
  b('loopback-encoded', 'http://0x7f000001/', 'шестнадцатеричная запись'),
  b('loopback-encoded', 'http://2130706433/', 'десятичная запись'),
  b('loopback-encoded', 'http://0177.0.0.1/', 'восьмеричная запись'),
  b('loopback-encoded', 'http://0x7f.0.0.1/', 'смешанная hex-запись'),
  b('loopback-ipv6', 'http://[::1]/', 'IPv6 loopback'),
  b('loopback-ipv6', 'http://[::ffff:127.0.0.1]/', 'IPv4-mapped IPv6'),
  b('loopback-ipv6', 'http://[::ffff:7f00:1]/', 'IPv4-mapped IPv6, hex'),
  b('metadata', 'http://169.254.169.254/latest/meta-data/', 'метаданные облака (link-local)'),
  b('metadata', 'http://metadata.google.internal/computeMetadata/v1/', 'метаданные GCP по имени'),
  b('metadata', 'http://169.254.169.254.nip.io/', 'домен, резолвящийся в metadata-адрес', { requiresDns: true }),
  b('private', 'http://10.0.0.1/', '10.0.0.0/8'),
  b('private', 'http://172.16.0.1/', '172.16.0.0/12'),
  b('private', 'http://172.31.255.254/', 'верхняя граница 172.16.0.0/12'),
  b('private', 'http://192.168.1.1/', '192.168.0.0/16'),
  b('private', 'http://100.64.0.1/', 'CGNAT 100.64.0.0/10'),
  b('unspecified', 'http://0.0.0.0/', 'неопределённый адрес, часто ведёт на localhost'),
  b('scheme', 'file:///etc/passwd', 'схема file'),
  b('scheme', 'gopher://127.0.0.1:6379/_PING', 'схема gopher'),
  b('scheme', 'ftp://example.com/resume.pdf', 'схема ftp (разрешены только http/https)'),
  b('scheme', 'javascript:alert(1)', 'схема javascript'),
  b('scheme', 'data:text/html,hello', 'схема data'),
  b('userinfo-trick', 'http://example.com@127.0.0.1/', 'хост после @ — это 127.0.0.1'),
  b('userinfo-trick', 'http://127.0.0.1#@example.com/', 'фрагмент не должен менять хост'),
  b('userinfo-trick', 'https://user:pass@10.0.0.1/', 'учётные данные в URL и приватный адрес'),
  b('dns-rebinding', 'http://localtest.me/', 'домен, резолвящийся в 127.0.0.1; проверять IP после резолва', { requiresDns: true }),
  b('dns-rebinding', 'http://127.0.0.1.nip.io/', 'домен-обёртка loopback', { requiresDns: true }),
  b('redirect', 'https://redirect.test.invalid/to-localhost', 'ответ 302 на http://127.0.0.1/ — блокировать при следовании', { fixture: { redirectChain: ['http://127.0.0.1/'] } }),
  b('redirect', 'https://redirect.test.invalid/to-metadata', 'ответ 302 на http://169.254.169.254/', { fixture: { redirectChain: ['http://169.254.169.254/latest/meta-data/'] } }),
  b('redirect', 'https://redirect.test.invalid/loop', 'длинная цепочка из 11 редиректов; лимит — 5', { fixture: { redirectChain: Array.from({ length: 11 }, (_, i) => `https://redirect.test.invalid/hop-${i + 1}`) } }),
  ok('https://github.com/octocat', 'профиль GitHub'),
  ok('https://github.com/octocat/Hello-World', 'репозиторий GitHub'),
  ok('https://codeforces.com/profile/tourist', 'профиль Codeforces'),
  ok('https://stackoverflow.com/users/22656/jon-skeet', 'профиль Stack Overflow'),
  ok('https://example.com/', 'публичный сайт'),
  ok('http://example.org/portfolio?ref=cv', 'http с query'),
];
const doc = {
  note: 'blocked=true: fetchUrl обязан отказать (в том числе при следовании редиректам). requiresDns=true: проверка IP после резолва, в юнит-тесте нужен подставной резолвер. fixture.redirectChain: цепочка ответов 3xx для подставного HTTP-слоя.',
  limits: { maxRedirects: 5, allowedSchemes: ['http', 'https'] },
  urls,
};
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'ssrf', 'urls.json'), JSON.stringify(doc, null, 2) + '\n');
console.log(`ssrf urls: ${urls.length} (blocked ${urls.filter((u) => u.blocked).length})`);
