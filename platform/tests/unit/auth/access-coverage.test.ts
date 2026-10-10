import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

import {
  ACTION_ACCESS,
  API_ACCESS,
  type ApiLevel,
  type ApiRule,
  type HttpMethod,
  PAGE_ACCESS,
  type PageLevel,
  matchRoute,
} from '@/server/auth/access';

// Deny by default (E-05, фаза 1; R-N-07, R-C-16): у каждой страницы, обработчика API и server action есть
// запись в матрице доступа И вызов гварда её уровня. Запись без вызова оставила бы путь открытым при зелёном
// тесте полноты — поэтому проверяем оба условия статически, по исходникам.

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

/** Исходник файла плюс его локальные импорты одного уровня (общая серверная часть страниц-вариантов). */
function sourceWithLocalImports(file: string): string {
  const src = readFileSync(file, 'utf8');
  const locals = [...src.matchAll(/from '(\.\.?\/[^']+)'/g)].flatMap(([, spec]) => {
    const base = resolve(dirname(file), spec!);
    for (const ext of ['', '.tsx', '.ts']) {
      try {
        if (statSync(base + ext).isFile()) return [readFileSync(base + ext, 'utf8')];
      } catch {
        // нет такого файла — пробуем следующее расширение
      }
    }
    return [];
  });
  return [src, ...locals].join('\n');
}

const files = walk(APP);
const pages = files.filter((f) => f.endsWith(`${sep}page.tsx`)).map((f) => ({ file: f, route: routeOf(f) }));
const routes = files.filter((f) => f.endsWith(`${sep}route.ts`)).map((f) => ({ file: f, route: routeOf(f) }));

/** Гварды страниц по уровню; `requirePageAccess` читает таблицу сам и подходит любому уровню. */
const PAGE_GUARD: Record<Exclude<PageLevel, 'public'>, RegExp> = {
  account: /\brequirePage(Account|Access)\(/,
  candidate: /\brequirePage(Candidate|Access)\(/,
  employer: /\brequirePage(Employer|Access)\(/,
};
const ANY_PAGE_GUARD = /\brequirePage(Account|Candidate|Employer|Access|User)\(/;

const API_GUARD: Record<Exclude<ApiLevel, 'public'>, (code: string) => boolean> = {
  candidate: (c) => /\brequireCandidate\(req\)/.test(c),
  employer: (c) => /\brequireEmployer\(req\)/.test(c),
  account: (c) => /\brequireUser\(req\)/.test(c),
  // Любой вход, включая старую демо-куку: getSession + 401 (так же распознаёт scripts/openapi/build.ts).
  session: (c) => /\bgetSession\(req\)/.test(c) && /errors\.unauthorized\(\)/.test(c),
  dev: (c) => /\bdevRoute\(/.test(c),
};

const METHOD_RE = /^export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/gm;

/** Код каждого экспортированного обработчика: от его `export` до следующего. */
function handlers(code: string): Array<[HttpMethod, string]> {
  const starts = [...code.matchAll(METHOD_RE)].map((m) => ({ method: m[1] as HttpMethod, at: m.index }));
  return starts.map((s, i) => [s.method, code.slice(s.at, starts[i + 1]?.at ?? code.length)]);
}

function levelOf(rule: ApiRule, method: HttpMethod): ApiLevel | undefined {
  return typeof rule === 'string' ? rule : rule[method];
}

describe('матрица страниц: полнота', () => {
  it('нашлись страницы и маршруты (обход не пустой)', () => {
    expect(pages.length).toBeGreaterThan(20);
    expect(routes.length).toBeGreaterThan(40);
  });

  it.each(pages.map((p) => [p.route, p] as const))('%s — есть запись в PAGE_ACCESS, и адрес находит именно её', (route) => {
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
    // Гварды других уровней на странице — ошибка (страница кандидата с requirePageAccount пустила бы всех).
    const others = (Object.keys(PAGE_GUARD) as Array<keyof typeof PAGE_GUARD>).filter((l) => l !== level);
    for (const other of others) {
      const wrapper = new RegExp(`\\brequirePage${other[0]!.toUpperCase()}${other.slice(1)}\\(`);
      expect(code, `${route}: гвард уровня ${other}`).not.toMatch(wrapper);
    }
    expect(code, `${route}: requirePageUser вне таблицы`).not.toMatch(/\brequirePageUser\(/);
    // Гвард получает адрес этой страницы: в исходнике есть строка с её статичной частью.
    const staticPrefix = route.split('/[')[0]!;
    expect(code, `${route}: гварду передан адрес страницы`).toMatch(new RegExp(`['"\`]${staticPrefix.replace(/[/]/g, '\\/')}`));
  });

  it('public-страницы без гварда — только явные записи таблицы (у прочих гвард есть)', () => {
    const unguarded = pages.filter((p) => !ANY_PAGE_GUARD.test(sourceWithLocalImports(p.file))).map((p) => p.route);
    for (const r of unguarded) expect(PAGE_ACCESS[r as keyof typeof PAGE_ACCESS], r).toBe('public');
  });
});

describe('матрица API: полнота и вызов гварда', () => {
  it.each(routes.map((r) => [r.route, r] as const))('%s', (route, { file }) => {
    expect(Object.keys(API_ACCESS), `${route}: нет записи в API_ACCESS`).toContain(route);
    expect(matchRoute(API_ACCESS, sampleOf(route))).toBe(route);
    const rule: ApiRule = API_ACCESS[route as keyof typeof API_ACCESS];
    const hs = handlers(readFileSync(file, 'utf8'));
    expect(hs.length, `${route}: не найдено ни одного обработчика`).toBeGreaterThan(0);
    for (const [method, code] of hs) {
      const level = levelOf(rule, method);
      expect(level, `${route} ${method}: метод без записи`).toBeDefined();
      if (level === 'public' || level === undefined) continue;
      expect(API_GUARD[level](code), `${route} ${method}: нужен гвард уровня ${level}`).toBe(true);
    }
  });

  it('dev-уровень — ровно маршруты /api/dev/*', () => {
    for (const [route, rule] of Object.entries(API_ACCESS)) {
      expect(rule === 'dev', route).toBe(route.startsWith('/api/dev/'));
    }
  });

  it('у каждой записи API_ACCESS есть маршрут', () => {
    const existing = new Set(routes.map((r) => r.route));
    expect(Object.keys(API_ACCESS).filter((k) => !existing.has(k))).toEqual([]);
  });
});

describe('server actions', () => {
  const actionFiles = walk(SRC).filter((f) => /\.tsx?$/.test(f) && /^\s*['"]use server['"]/m.test(readFileSync(f, 'utf8')));

  it('каждый файл с "use server" — в ACTION_ACCESS, с проверкой уровня внутри', () => {
    expect(actionFiles.length).toBeGreaterThan(0);
    for (const file of actionFiles) {
      const key = relative(SRC, file).split(sep).join('/');
      expect(Object.keys(ACTION_ACCESS), `${key}: нет записи`).toContain(key);
      const level: PageLevel = ACTION_ACCESS[key as keyof typeof ACTION_ACCESS];
      if (level !== 'public') expect(readFileSync(file, 'utf8'), key).toMatch(PAGE_GUARD[level]);
    }
  });

  it('нет мёртвых записей ACTION_ACCESS', () => {
    const keys = new Set(actionFiles.map((f) => relative(SRC, f).split(sep).join('/')));
    expect(Object.keys(ACTION_ACCESS).filter((k) => !keys.has(k))).toEqual([]);
  });
});
