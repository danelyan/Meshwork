import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  ACTION_ACCESS,
  ADMIN_PUBLIC_ROUTES,
  API_ACCESS,
  type ApiLevel,
  type ApiRule,
  type HttpMethod,
  PAGE_ACCESS,
  type PageLevel,
  isAdminRoute,
  matchRoute,
} from '@/server/auth/access';

// Deny by default (E-05, фаза 1; R-N-07, R-C-16): у каждой страницы, обработчика API и server action есть
// запись в матрице доступа И вызов гварда её уровня. Запись без вызова оставила бы путь открытым при зелёном
// тесте полноты – поэтому проверяем оба условия статически, по исходникам.

const SRC = resolve(__dirname, '../../../src');
const APP = join(SRC, 'app');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Шаблон маршрута из пути файла: группы `(x)` из адреса вырезаются (docs Next.js: Route Groups). */
function routeOf(file: string): string {
  const segs = relative(APP, dirname(file))
    .split(sep)
    .filter((s) => s && !/^\(.+\)$/.test(s));
  return `/${segs.join('/')}`;
}

/** Пример реального адреса для шаблона: `[id]` → `sample-id`. */
function sampleOf(pattern: string): string {
  return pattern.replace(/\[([^\]]+)\]/g, 'sample-$1');
}

/**
 * Код без комментариев: гвард в `//…` или `/*…*​/` не считается вызовом. Строки и шаблоны не разбираем
 * (`//` внутри строки `https://…` вырезать нельзя) – сначала прячем литералы, потом режем комментарии.
 */
export function stripComments(src: string): string {
  const lits: string[] = [];
  const hidden = src.replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, (m) => `\u0000${lits.push(m) - 1}\u0000`);
  const cut = hidden.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '');
  return cut.replace(/\u0000(\d+)\u0000/g, (_, i) => lits[Number(i)]!);
}

/** Исходник файла плюс его локальные импорты одного уровня (общая серверная часть страниц-вариантов). */
function sourceWithLocalImports(file: string): string {
  const src = stripComments(readFileSync(file, 'utf8'));
  const locals = [...src.matchAll(/from '(\.\.?\/[^']+)'/g)].flatMap(([, spec]) => {
    const base = resolve(dirname(file), spec!);
    for (const ext of ['', '.tsx', '.ts']) {
      try {
        if (statSync(base + ext).isFile()) return [stripComments(readFileSync(base + ext, 'utf8'))];
      } catch {
        // нет такого файла – пробуем следующее расширение
      }
    }
    return [];
  });
  return [src, ...locals].join('\n');
}

const files = walk(APP);
const allPages = files.filter((f) => f.endsWith(`${sep}page.tsx`)).map((f) => ({ file: f, route: routeOf(f) }));
const allRoutes = files.filter((f) => f.endsWith(`${sep}route.ts`)).map((f) => ({ file: f, route: routeOf(f) }));
// Админка (E-08, ADR 0009) – свой контур: кука персонала, гвард requirePageStaff / requireStaff (отдельный блок ниже).
const pages = allPages.filter((p) => !isAdminRoute(p.route));
const routes = allRoutes.filter((r) => !isAdminRoute(r.route));
const adminPages = allPages.filter((p) => isAdminRoute(p.route));
const adminRoutes = allRoutes.filter((r) => isAdminRoute(r.route));

/** Гварды страниц по уровню; `requirePageAccess` читает таблицу сам и подходит любому уровню. */
const PAGE_GUARD: Record<Exclude<PageLevel, 'public'>, RegExp> = {
  account: /\brequirePage(Account|Access)\(/,
  candidate: /\brequirePage(Candidate|Access)\(/,
  employer: /\brequirePage(Employer|Access)\(/,
};
const ANY_PAGE_GUARD = /\brequirePage(Account|Candidate|Employer|Access|User|Staff)\(/;

/**
 * Каждый вызов `requirePageAccess(...)` обязан получать строковый литерал с адресом этой страницы:
 * статичный маршрут – его же (до query), динамический – строку, начинающуюся со статичного префикса.
 * `requirePageAccess('/')` на чужой странице или переменная вместо адреса – ошибка. Возвращает причины.
 */
export function pageAccessArgProblems(code: string, route: string): string[] {
  const staticPrefix = route.split('/[')[0]!;
  const dynamic = route.includes('/[');
  const problems: string[] = [];
  for (const m of code.matchAll(/\brequirePageAccess\(\s*([^)]*)/g)) {
    const arg = m[1]!.trim();
    const lit = /^(['"`])([^'"`]*)/.exec(arg);
    if (!lit) {
      problems.push(`аргумент не строковый литерал: ${arg.slice(0, 30)}`);
      continue;
    }
    const value = lit[2]!;
    const path = value.split(/[?#]/, 1)[0]!;
    const ok = dynamic ? value.startsWith(`${staticPrefix}/`) : path === route;
    if (!ok) problems.push(`адрес ${value} не относится к ${route}`);
  }
  return problems;
}

const API_GUARD: Record<Exclude<ApiLevel, 'public'>, (code: string) => boolean> = {
  candidate: (c) => /\brequireCandidate\(req\)/.test(c),
  employer: (c) => /\brequireEmployer\(req\)/.test(c),
  account: (c) => /\brequireUser\(req\)/.test(c),
  // Любой вход, включая старую демо-куку: getSession + 401 (так же распознаёт scripts/openapi/build.ts).
  session: (c) => /\bgetSession\(req\)/.test(c) && /errors\.unauthorized\(\)/.test(c),
  dev: (c) => /\bdevRoute\(/.test(c),
};

const METHOD_RE = /^export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/gm;
const REEXPORT_RE = /^export \{([^}]*)\}/gm;

/**
 * Код каждого экспортированного обработчика: от его `export` до следующего. Хелпер после последнего
 * обработчика (то, что идёт после закрытия функции на уровне колонки 0) ему не засчитывается.
 * Реэкспорт `export { h as POST }` – обработчик с кодом всего файла; если метод так и не распознан
 * (экспорт неведомой формы), `unrecognizedExports` это ловит.
 */
export function handlers(code: string): Array<[HttpMethod, string]> {
  const starts = [...code.matchAll(METHOD_RE)].map((m) => ({ method: m[1] as HttpMethod, at: m.index }));
  const own = starts.map((s, i): [HttpMethod, string] => {
    let end = starts[i + 1]?.at ?? code.length;
    if (i === starts.length - 1) {
      // Тело последнего обработчика кончается закрытием на нулевой колонке; дальше – хелперы.
      const close = /^[})]/m.exec(code.slice(s.at + 1));
      const closeAt = close ? s.at + 1 + close.index : -1;
      const next = closeAt >= 0 ? /^(?:export |async function |function |const |let |class )/m.exec(code.slice(closeAt)) : null;
      if (next) end = closeAt + next.index;
    }
    return [s.method, code.slice(s.at, end)];
  });
  const re: Array<[HttpMethod, string]> = [];
  for (const m of code.matchAll(REEXPORT_RE)) {
    for (const part of m[1]!.split(',')) {
      const as = /\bas\s+(GET|POST|PUT|PATCH|DELETE)\b/.exec(part) ?? /^\s*(GET|POST|PUT|PATCH|DELETE)\s*$/.exec(part);
      if (as) re.push([as[1] as HttpMethod, code]);
    }
  }
  return [...own, ...re];
}

/** Экспорты HTTP-методов, которых не распознал `handlers` (например, `export const { GET } = …`). */
export function unrecognizedExports(code: string): string[] {
  const found = handlers(code).length;
  const all = [...code.matchAll(/^export\b[^\n]*\b(?:GET|POST|PUT|PATCH|DELETE)\b/gm)];
  return all.length > found ? all.map((m) => m[0]) : [];
}

function levelOf(rule: ApiRule, method: HttpMethod): ApiLevel | undefined {
  return typeof rule === 'string' ? rule : rule[method];
}

describe('матрица страниц: полнота', () => {
  it('нашлись страницы и маршруты (обход не пустой)', () => {
    expect(pages.length).toBeGreaterThan(20);
    expect(routes.length).toBeGreaterThan(40);
  });

  it.each(pages.map((p) => [p.route, p] as const))('%s – есть запись в PAGE_ACCESS, и адрес находит именно её', (route) => {
    expect(Object.keys(PAGE_ACCESS)).toContain(route);
    expect(matchRoute(PAGE_ACCESS, sampleOf(route))).toBe(route);
  });

  // Страницу /employer/company делает параллельный лейн company; после слияния исключение лишнее, но безвредное.
  const PENDING_PAGES = new Set(['/employer/company']);
  it('у каждой записи PAGE_ACCESS есть страница (нет мёртвых строк)', () => {
    const existing = new Set(pages.map((p) => p.route));
    const dead = Object.keys(PAGE_ACCESS).filter((k) => !existing.has(k) && !PENDING_PAGES.has(k));
    expect(dead).toEqual([]);
  });
});

describe('матрица страниц: вызов гварда своего уровня', () => {
  it.each(pages.map((p) => [p.route, p] as const))('%s', (route, { file }) => {
    const level: PageLevel = PAGE_ACCESS[route as keyof typeof PAGE_ACCESS];
    const code = sourceWithLocalImports(file);
    if (level === 'public') return;
    expect(code, `${route}: нужен гвард уровня ${level}`).toMatch(PAGE_GUARD[level]);
    // Гварды других уровней на странице – ошибка (страница кандидата с requirePageAccount пустила бы всех).
    const others = (Object.keys(PAGE_GUARD) as Array<keyof typeof PAGE_GUARD>).filter((l) => l !== level);
    for (const other of others) {
      const wrapper = new RegExp(`\\brequirePage${other[0]!.toUpperCase()}${other.slice(1)}\\(`);
      expect(code, `${route}: гвард уровня ${other}`).not.toMatch(wrapper);
    }
    expect(code, `${route}: requirePageUser вне таблицы`).not.toMatch(/\brequirePageUser\(/);
    expect(pageAccessArgProblems(code, route), `${route}: requirePageAccess`).toEqual([]);
    // Гвард получает адрес этой страницы: в исходнике есть строка с её статичной частью.
    const staticPrefix = route.split('/[')[0]!;
    expect(code, `${route}: гварду передан адрес страницы`).toMatch(new RegExp(`['"\`]${staticPrefix.replace(/[/]/g, '\\/')}`));
  });

  it('public-страницы без гварда – только явные записи таблицы (у прочих гвард есть)', () => {
    const unguarded = pages.filter((p) => !ANY_PAGE_GUARD.test(sourceWithLocalImports(p.file))).map((p) => p.route);
    for (const r of unguarded) expect(PAGE_ACCESS[r as keyof typeof PAGE_ACCESS], r).toBe('public');
  });
});

describe('матрица API: полнота и вызов гварда', () => {
  it.each(routes.map((r) => [r.route, r] as const))('%s', (route, { file }) => {
    expect(Object.keys(API_ACCESS), `${route}: нет записи в API_ACCESS`).toContain(route);
    expect(matchRoute(API_ACCESS, sampleOf(route))).toBe(route);
    const rule: ApiRule = API_ACCESS[route as keyof typeof API_ACCESS];
    const src = stripComments(readFileSync(file, 'utf8'));
    const hs = handlers(src);
    expect(unrecognizedExports(src), `${route}: экспорт метода не распознан тестом`).toEqual([]);
    expect(hs.length, `${route}: не найдено ни одного обработчика`).toBeGreaterThan(0);
    for (const [method, code] of hs) {
      const level = levelOf(rule, method);
      expect(level, `${route} ${method}: метод без записи`).toBeDefined();
      if (level === 'public' || level === undefined) continue;
      expect(API_GUARD[level](code), `${route} ${method}: нужен гвард уровня ${level}`).toBe(true);
    }
  });

  it('dev-уровень – ровно маршруты /api/dev/*', () => {
    for (const [route, rule] of Object.entries(API_ACCESS)) {
      expect(rule === 'dev', route).toBe(route.startsWith('/api/dev/'));
    }
  });

  it('у каждой записи API_ACCESS есть маршрут', () => {
    const existing = new Set(routes.map((r) => r.route));
    expect(Object.keys(API_ACCESS).filter((k) => !existing.has(k))).toEqual([]);
  });
});

describe('админка: каждый маршрут под гвардом персонала', () => {
  it('фундамент админки на месте', () => {
    expect(adminPages.map((p) => p.route)).toContain('/admin/login');
    expect(adminRoutes.map((r) => r.route)).toContain('/api/admin/auth/totp');
  });

  it('публичные шаги входа существуют (нет мёртвых строк)', () => {
    const existing = new Set([...adminPages, ...adminRoutes].map((x) => x.route));
    expect(ADMIN_PUBLIC_ROUTES.filter((r) => !existing.has(r))).toEqual([]);
  });

  it('демо-вход – публичный bootstrap с CSRF, флагом и сессией только для чтения', () => {
    const route = '/api/admin/auth/demo';
    expect(ADMIN_PUBLIC_ROUTES).toContain(route);
    const entry = adminRoutes.find((r) => r.route === route)!;
    const code = stripComments(readFileSync(entry.file, 'utf8'));
    const hs = handlers(code);
    expect(hs.map(([method]) => method)).toEqual(['POST']);
    const post = hs[0]![1];
    expect(post).toMatch(/assertSameOrigin\(req\)/);
    expect(post).toMatch(/await demoLogin\(req\)/);
    expect(post.indexOf('assertSameOrigin(req)')).toBeLessThan(post.indexOf('demoLogin(req)'));
    const staff = stripComments(readFileSync(join(SRC, 'server/admin/staff.ts'), 'utf8'));
    expect(staff).toMatch(/if \(!getEnv\(\)\.DEMO_LOGIN\) throw errors\.forbidden/);
    const session = stripComments(readFileSync(join(SRC, 'server/admin/session.ts'), 'utf8'));
    expect(session).toMatch(/if \(ctx\.demo && !demoAllows\(req, action\)\) throw errors\.forbidden/);
    expect(session).toMatch(/if \(action && !DEMO_STAFF_ACTIONS\.has\(action\)\) return false/);
    expect(session).toMatch(/if \(req\.method === 'GET' \|\| req\.method === 'HEAD'\) return true/);
    expect(session).toMatch(/return new URL\(req\.url\)\.pathname === '\/api\/admin\/auth\/logout'/);
  });

  it.each(adminPages.filter((p) => !ADMIN_PUBLIC_ROUTES.includes(p.route)).map((p) => [p.route, p] as const))('страница %s – requirePageStaff со своим адресом', (route, { file }) => {
    const code = sourceWithLocalImports(file);
    const staticPrefix = route.split('/[')[0]!;
    const m = /\brequirePageStaff\(\s*(['"`])([^'"`]*)/.exec(code);
    expect(m, `${route}: нужен requirePageStaff('<адрес>', '<право>')`).not.toBeNull();
    const value = m![2]!;
    expect(route.includes('/[') ? value.startsWith(`${staticPrefix}/`) : value.split(/[?#]/, 1)[0] === route, `${route}: адрес ${value}`).toBe(true);
    // Пользовательские гварды на странице админки – ошибка: пустили бы по cid.
    expect(code).not.toMatch(/\brequirePage(Account|Candidate|Employer|Access|User)\(/);
  });

  it.each(adminRoutes.map((r) => [r.route, r] as const))('API %s – requireStaff(req…) в каждом обработчике', (route, { file }) => {
    const src = stripComments(readFileSync(file, 'utf8'));
    const hs = handlers(src);
    expect(unrecognizedExports(src)).toEqual([]);
    expect(hs.length).toBeGreaterThan(0);
    if (ADMIN_PUBLIC_ROUTES.includes(route)) return;
    for (const [method, code] of hs) expect(/\brequireStaff\(req\b/.test(code), `${route} ${method}: нужен requireStaff(req…)`).toBe(true);
  });
});

describe('server actions', () => {
  const actionFiles = walk(SRC).filter((f) => /\.tsx?$/.test(f) && /^\s*['"]use server['"]/m.test(readFileSync(f, 'utf8')));

  it('каждый файл с "use server" – в ACTION_ACCESS, с проверкой уровня внутри', () => {
    expect(actionFiles.length).toBeGreaterThan(0);
    for (const file of actionFiles) {
      const key = relative(SRC, file).split(sep).join('/');
      expect(Object.keys(ACTION_ACCESS), `${key}: нет записи`).toContain(key);
      const level: PageLevel = ACTION_ACCESS[key as keyof typeof ACTION_ACCESS];
      if (level !== 'public') expect(stripComments(readFileSync(file, 'utf8')), key).toMatch(PAGE_GUARD[level]);
    }
  });

  it('нет мёртвых записей ACTION_ACCESS', () => {
    const keys = new Set(actionFiles.map((f) => relative(SRC, f).split(sep).join('/')));
    expect(Object.keys(ACTION_ACCESS).filter((k) => !keys.has(k))).toEqual([]);
  });
});

describe('мутационные проверки самого теста (фикстуры исходников)', () => {
  const PAGE = (body: string) => stripComments(body);

  it('гвард в комментарии не засчитывается', () => {
    const code = PAGE(`// await requirePageCandidate('/profile');\n/* requirePageAccess('/profile') */\nexport default function P() {}`);
    expect(code).not.toMatch(PAGE_GUARD.candidate);
  });
  it('`//` внутри строки не режет код после неё', () => {
    const code = PAGE(`const u = 'https://x.y'; await requirePageCandidate('/profile'); // хвост`);
    expect(code).toMatch(PAGE_GUARD.candidate);
  });
  it("requirePageAccess('/') на странице кандидата ловится", () => {
    expect(pageAccessArgProblems(`await requirePageAccess('/')`, '/profile')).not.toEqual([]);
    expect(pageAccessArgProblems(`await requirePageAccess('/profile')`, '/profile')).toEqual([]);
    expect(pageAccessArgProblems(`await requirePageAccess(path)`, '/profile')).not.toEqual([]);
  });
  it('динамический маршрут: адрес со статичным префиксом принимается, чужой – нет', () => {
    expect(pageAccessArgProblems('await requirePageAccess(`/employer/needs/${id}`)', '/employer/needs/[id]')).toEqual([]);
    expect(pageAccessArgProblems(`await requirePageAccess('/employer')`, '/employer/needs/[id]')).not.toEqual([]);
  });
  it('реэкспорт export { h as POST } распознаётся и требует гварда', () => {
    const code = `async function h(req: Request) { return requireCandidate(req); }\nexport { h as POST };`;
    expect(handlers(code).map(([m]) => m)).toEqual(['POST']);
    expect(API_GUARD.candidate(handlers(code)[0]![1])).toBe(true);
    const bad = `async function h(req: Request) { return 1; }\nexport { h as POST };`;
    expect(API_GUARD.candidate(handlers(bad)[0]![1])).toBe(false);
  });
  it('нераспознанный экспорт метода роняет тест, а не пропускается', () => {
    expect(unrecognizedExports(`export const { GET } = make();`)).not.toEqual([]);
    expect(unrecognizedExports(`export async function GET(req: Request) { return 1; }`)).toEqual([]);
  });
  it('хелпер после последнего экспорта не засчитывается последнему методу', () => {
    const code = `export async function GET(req: Request) {\n  return 1;\n}\n\nfunction helper(req: Request) {\n  return requireCandidate(req);\n}\n`;
    expect(API_GUARD.candidate(handlers(code)[0]![1])).toBe(false);
    const ok = `export async function GET(req: Request) {\n  requireCandidate(req);\n  return 1;\n}\n`;
    expect(API_GUARD.candidate(handlers(ok)[0]![1])).toBe(true);
  });
});
