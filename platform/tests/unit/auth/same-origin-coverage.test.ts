import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { assertSameOrigin } from '@/server/auth/csrf';
import { AppError } from '@/server/errors';

// Проверка Origin (server/auth/csrf.ts) стоит в каждом изменяющем обработчике API. Проверяем статически, по
// исходникам: забытый вызов в новом маршруте должен ронять тест, а не ждать ревью.

const API = path.join(process.cwd(), 'src/app/api');

/** Вне этой проверки: вход и регистрация (`auth`), локальные дебаг-маршруты (`dev`), контур админки (`admin`). */
const SKIPPED_PREFIXES = ['auth/', 'dev/', 'admin/'];
/** Обработчики без проверки – каждый с причиной. */
const EXCEPTIONS: Record<string, string> = {
  'demo/login DELETE': 'только сбрасывает куку сессии; обработчик без параметра запроса',
};
/** Маршруты, где проверка – первое действие обработчика (до чтения сессии и тела). */
const FIRST_STATEMENT_PREFIXES = ['test/', 'claims/', 'consultant/', 'defense/', 'uploads/', 'sources/', 'stt/', 'tts/', 'employer/assistant/', 'expert/', 'demo/login/'];

interface Handler {
  route: string;
  method: string;
  body: string;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

function mutatingHandlers(): Handler[] {
  const out: Handler[] = [];
  for (const file of walk(API).filter((f) => path.basename(f) === 'route.ts')) {
    const src = readFileSync(file, 'utf8');
    const route = `${path.relative(API, path.dirname(file)).split(path.sep).join('/')}/`;
    const heads = [...src.matchAll(/^export (?:const|async function|function) (GET|HEAD|OPTIONS|POST|PUT|PATCH|DELETE)\b/gm)];
    heads.forEach((m, i) => {
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(m[1]!)) return;
      out.push({ route, method: m[1]!, body: src.slice(m.index, heads[i + 1]?.index ?? src.length) });
    });
  }
  return out;
}

const handlers = mutatingHandlers().filter((h) => !SKIPPED_PREFIXES.some((p) => h.route.startsWith(p)));
const keyOf = (h: Handler) => `${h.route.replace(/\/$/, '')} ${h.method}`;

describe('проверка Origin в изменяющих обработчиках API', () => {
  it('обработчики найдены, исключения существуют', () => {
    expect(handlers.length).toBeGreaterThan(50);
    const keys = new Set(handlers.map(keyOf));
    for (const key of Object.keys(EXCEPTIONS)) expect(keys.has(key), key).toBe(true);
  });

  it('каждый POST/PUT/PATCH/DELETE вызывает assertSameOrigin(req)', () => {
    const missing = handlers.filter((h) => !(keyOf(h) in EXCEPTIONS) && !h.body.includes('assertSameOrigin(req)')).map(keyOf);
    expect(missing).toEqual([]);
  });

  it('тест, утверждения, консультант, защита, файлы, источники, голос, эксперт, демо-вход: проверка – первым действием', () => {
    const late = handlers
      .filter((h) => FIRST_STATEMENT_PREFIXES.some((p) => h.route.startsWith(p)) && !(keyOf(h) in EXCEPTIONS))
      .filter((h) => h.body.split('\n')[1]?.trim() !== 'assertSameOrigin(req);')
      .map(keyOf);
    expect(late).toEqual([]);
  });
});

describe('assertSameOrigin', () => {
  const req = (origin?: string) => new Request('http://localhost:3000/api/test/start', { method: 'POST', headers: origin ? { origin } : {} });
  const statusOf = (origin?: string) => {
    try {
      assertSameOrigin(req(origin));
      return 200;
    } catch (err) {
      return err instanceof AppError ? err.status : 500;
    }
  };

  it('без Origin (сервер, тесты) и со своим Origin – пропускает; чужой сайт – 403', () => {
    expect(statusOf()).toBe(200);
    expect(statusOf('http://localhost:3000')).toBe(200);
    expect(statusOf('https://evil.example')).toBe(403);
    expect(statusOf('http://localhost.evil.example')).toBe(403);
  });
});
