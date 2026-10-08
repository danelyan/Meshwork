import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { AppError } from '../errors';
import { LIMITS } from './limits';

/**
 * SSRF-фильтр сборщика (E-01 § 6, OWASP SSRF Prevention Cheat Sheet):
 *  - только http/https, без userinfo, порты 80/443/8080/8443;
 *  - имя хоста: не localhost/.local/.internal/односложное; IP в любой записи
 *    (десятичная, hex, восьмеричная, сокращённая, IPv6, IPv4-mapped) нормализуется;
 *  - DNS резолвится ДО запроса, проверяются ВСЕ адреса, соединение пиннится на
 *    проверенный адрес (url.ts → undici `connect.lookup`), чтобы DNS-rebinding
 *    между проверкой и запросом не сработал;
 *  - каждый редирект проходит ту же проверку заново (url.ts).
 */

export const blockedUrl = (reason: string) =>
  new AppError('blocked_url', `Ссылка недоступна для чтения: ${reason}`, 400, { reason });

// ---------- IPv4 ----------

/** Разбор IPv4 в любой записи inet_aton: 127.1, 0x7f000001, 2130706433, 0177.0.0.1. null — не IPv4. */
export function parseIPv4(host: string): number | null {
  const parts = host.split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  if (parts.at(-1) === '' && parts.length > 1) parts.pop(); // завершающая точка
  const nums: number[] = [];
  for (const p of parts) {
    if (p === '') return null;
    let n: number;
    if (/^0x[0-9a-f]*$/i.test(p)) n = p.length === 2 ? 0 : parseInt(p.slice(2), 16);
    else if (/^0[0-7]+$/.test(p)) n = parseInt(p.slice(1), 8);
    else if (/^(0|[1-9]\d*)$/.test(p)) n = Number(p);
    else return null;
    if (!Number.isFinite(n)) return null;
    nums.push(n);
  }
  const last = nums.pop()!;
  if (nums.some((n) => n > 255)) return null;
  const restBits = 8 * (4 - nums.length);
  if (last >= 2 ** restBits) return null;
  let v = 0;
  for (const n of nums) v = v * 256 + n;
  return v * 2 ** restBits + last;
}

const v4 = (a: number, b: number, c: number, d: number) => ((a * 256 + b) * 256 + c) * 256 + d;
const BLOCKED_V4: [number, number][] = [
  [v4(0, 0, 0, 0), 8], // «этот» адрес, 0.0.0.0
  [v4(10, 0, 0, 0), 8], // частная
  [v4(100, 64, 0, 0), 10], // CGNAT
  [v4(127, 0, 0, 0), 8], // loopback
  [v4(169, 254, 0, 0), 16], // link-local + metadata 169.254.169.254
  [v4(172, 16, 0, 0), 12], // частная
  [v4(192, 0, 0, 0), 24], // IETF protocol assignments
  [v4(192, 0, 2, 0), 24], // TEST-NET-1
  [v4(192, 88, 99, 0), 24], // 6to4 relay
  [v4(192, 168, 0, 0), 16], // частная
  [v4(198, 18, 0, 0), 15], // бенчмарки
  [v4(198, 51, 100, 0), 24], // TEST-NET-2
  [v4(203, 0, 113, 0), 24], // TEST-NET-3
  [v4(224, 0, 0, 0), 4], // multicast
  [v4(240, 0, 0, 0), 4], // резерв + broadcast 255.255.255.255
];

export function isBlockedIPv4(v: number): boolean {
  return BLOCKED_V4.some(([net, bits]) => Math.floor(v / 2 ** (32 - bits)) === Math.floor(net / 2 ** (32 - bits)));
}

export function formatIPv4(v: number): string {
  return [24, 16, 8, 0].map((s) => Math.floor(v / 2 ** s) % 256).join('.');
}

// ---------- IPv6 ----------

/** IPv6 → 8 хекстетов (с поддержкой `::` и хвоста-IPv4). null — не IPv6. */
export function parseIPv6(input: string): number[] | null {
  let s = input.replace(/^\[|\]$/g, '');
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (isIP(s) !== 6) return null;
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const v = parseIPv4(dotted[2]!);
    if (v === null) return null;
    s = `${dotted[1]}${Math.floor(v / 65536).toString(16)}:${(v % 65536).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const nums = (x: string | undefined) => (x ? x.split(':').map((p) => parseInt(p, 16)) : []);
  const head = nums(halves[0]);
  if (halves.length === 1) return head.length === 8 ? head : null;
  const tail = nums(halves[1]);
  if (head.length + tail.length > 7) return null;
  return [...head, ...Array<number>(8 - head.length - tail.length).fill(0), ...tail];
}

/** Адрес IPv6 опасен? Встроенный IPv4 (mapped, compat, NAT64, 6to4) проверяется как IPv4. */
export function isBlockedIPv6(h: number[]): boolean {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0, g = 0, hh = 0] = h;
  const embedded = g * 65536 + hh;
  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0) {
    if (f === 0xffff) return isBlockedIPv4(embedded); // ::ffff:a.b.c.d — IPv4-mapped
    if (f === 0) return true; // ::, ::1, ::a.b.c.d (compat, устарело) — не пускаем
  }
  if (a === 0x64 && b === 0xff9b) return true; // NAT64 64:ff9b::/96 и /48 — ведёт во внутреннюю сеть шлюза
  if (a === 0x2002) return true; // 6to4 2002::/16 — встроенный IPv4 может быть внутренним, не пускаем
  if (a === 0x2001 && b === 0) return true; // Teredo
  if (a === 0x2001 && b === 0xdb8) return true; // документация
  if (a === 0x100 && b === 0 && c === 0 && d === 0) return true; // discard 100::/64
  if ((a & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((a & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((a & 0xffc0) === 0xfec0) return true; // site-local fec0::/10
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if ((a & 0xe000) !== 0x2000) return true; // всё вне global unicast 2000::/3
  return false;
}

export type IpCheck = { ip: string; family: 4 | 6; blocked: boolean } | null;

/** Строка — IP-литерал (в любой записи)? Возвращает нормализованный адрес и вердикт. */
export function classifyIpLiteral(host: string): IpCheck {
  const h = host.replace(/^\[|\]$/g, '');
  if (h.includes(':')) {
    const hex = parseIPv6(h);
    if (!hex) return null;
    return { ip: hex.map((x) => x.toString(16)).join(':'), family: 6, blocked: isBlockedIPv6(hex) };
  }
  const v = parseIPv4(h);
  if (v === null) return null;
  return { ip: formatIPv4(v), family: 4, blocked: isBlockedIPv4(v) };
}

// ---------- имена ----------

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.intranet', '.lan', '.home.arpa', '.corp', '.private', '.test', '.invalid', '.example', '.onion'];
const BLOCKED_NAMES = new Set(['localhost', 'metadata', 'metadata.google.internal', 'instance-data', 'kubernetes', 'kubernetes.default']);

export function isBlockedHostname(name: string): boolean {
  const h = name.toLowerCase().replace(/\.$/, '');
  if (BLOCKED_NAMES.has(h)) return true;
  if (!h.includes('.')) return true; // односложные имена — внутренние
  return BLOCKED_SUFFIXES.some((s) => h.endsWith(s));
}

// ---------- URL ----------

export const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);

export interface CheckedTarget {
  url: URL;
  hostname: string;
  /** Адрес, на который пиннится соединение. */
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;

export const systemResolver: Resolver = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/** Статическая проверка URL без сети: схема, userinfo, порт, имя/литерал IP. */
export function checkUrlSyntax(raw: string): { url: URL; literal: IpCheck } {
  if (typeof raw !== 'string' || raw.length === 0) throw blockedUrl('пустая ссылка');
  if (raw.length > LIMITS.urlMaxLength) throw blockedUrl('слишком длинная ссылка');
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) throw blockedUrl('недопустимые символы');
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw blockedUrl('некорректная ссылка');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw blockedUrl(`схема ${url.protocol} запрещена`);
  if (url.username || url.password) throw blockedUrl('учётные данные в ссылке запрещены');
  if (!ALLOWED_PORTS.has(url.port)) throw blockedUrl(`порт ${url.port} запрещён`);
  const host = url.hostname;
  if (!host) throw blockedUrl('нет хоста');
  const literal = classifyIpLiteral(host);
  if (literal) {
    if (literal.blocked) throw blockedUrl('внутренний адрес');
  } else if (isBlockedHostname(host)) {
    throw blockedUrl('внутреннее имя хоста');
  }
  url.hash = '';
  return { url, literal };
}

/** Полная проверка: синтаксис + резолв DNS, ВСЕ адреса должны быть публичными. */
export async function checkUrl(raw: string, resolve: Resolver = systemResolver): Promise<CheckedTarget> {
  const { url, literal } = checkUrlSyntax(raw);
  if (literal) return { url, hostname: url.hostname, address: literal.ip, family: literal.family };
  let addrs: { address: string; family: number }[];
  try {
    addrs = await resolve(url.hostname);
  } catch {
    throw new AppError('fetch_failed', 'Не удалось найти сайт по ссылке', 502);
  }
  if (addrs.length === 0) throw new AppError('fetch_failed', 'Не удалось найти сайт по ссылке', 502);
  for (const a of addrs) {
    const c = classifyIpLiteral(a.address);
    if (!c || c.blocked) throw blockedUrl('имя указывает на внутренний адрес');
  }
  const first = classifyIpLiteral(addrs[0]!.address)!;
  return { url, hostname: url.hostname, address: addrs[0]!.address, family: first.family };
}
