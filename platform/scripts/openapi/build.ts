// Ядро генератора OpenAPI 3.1: обходит src/app/api/**/route.ts (кроме api/dev), берёт из исходников методы,
// путь, JSDoc, роль доступа и Zod-схемы тела/query; описания ответов добавляются из overrides.ts.
// Запуск: `npx tsx scripts/build-openapi.ts` из platform/ (см. README). Тест сверяет результат с docs/openapi.yaml.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import * as ts from 'typescript';

import {
  COMPONENT_SCHEMAS,
  ERROR_RESPONSES,
  OVERRIDES,
  SSE_EVENTS_DOC,
  TAG_DESCRIPTIONS,
  type JsonSchema,
  type OpOverride,
} from './overrides';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];
type Role = 'public' | 'candidate' | 'employer' | 'user' | 'session';

export interface RouteOp {
  file: string;
  path: string;
  method: Method;
  doc: string;
  text: string;
  /** Локальные Zod-константы файла и импорты — для разбора схем. */
  scope: FileScope;
}

interface FileScope {
  dir: string;
  srcRoot: string;
  source: ts.SourceFile;
  imports: Map<string, string>;
  locals: Map<string, string>;
  cache: Map<string, unknown>;
}

// --- обход файлов ---

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'route.ts') out.push(p);
  }
  return out;
}

export function apiPathOf(apiRoot: string, file: string): string {
  const segs = relative(apiRoot, dirname(file)).split(sep).filter(Boolean);
  return '/api' + (segs.length ? '/' + segs.map((s) => s.replace(/^\[(.+)\]$/, '{$1}')).join('/') : '');
}

export function isDevRoute(apiRoot: string, file: string): boolean {
  return relative(apiRoot, file).split(sep)[0] === 'dev';
}

// --- разбор исходника ---

function jsDocOf(node: ts.Node, text: string): string {
  const ranges = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
  const block = [...ranges].reverse().find((r) => text.slice(r.pos, r.pos + 3) === '/**');
  if (!block) return '';
  return text
    .slice(block.pos + 3, block.end - 2)
    .split('\n')
    .map((l) => l.replace(/^\s*\*? ?/, ''))
    .join('\n')
    .trim();
}

function importMap(sf: ts.SourceFile): Map<string, string> {
  const m = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.importClause) continue;
    const bindings = st.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) {
        if (!st.importClause.isTypeOnly && !el.isTypeOnly) m.set(el.name.text, st.moduleSpecifier.text);
      }
    }
  }
  return m;
}

function localConsts(sf: ts.SourceFile): Map<string, string> {
  const m = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || st.modifiers?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer) m.set(d.name.text, d.initializer.getText(sf));
    }
  }
  return m;
}

export function parseRoute(file: string, apiRoot: string, srcRoot: string): RouteOp[] {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);
  const scope: FileScope = { dir: dirname(file), srcRoot, source: sf, imports: importMap(sf), locals: localConsts(sf), cache: new Map() };
  const ops: RouteOp[] = [];
  const path = apiPathOf(apiRoot, file);
  for (const st of sf.statements) {
    const exported = (st as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    let name: string | undefined;
    if (ts.isFunctionDeclaration(st) && st.name) name = st.name.text;
    else if (ts.isVariableStatement(st)) {
      const d = st.declarationList.declarations[0];
      if (d && ts.isIdentifier(d.name)) name = d.name.text;
    }
    if (!name || !(METHODS as readonly string[]).includes(name)) continue;
    ops.push({ file, path, method: name as Method, doc: jsDocOf(st, text), text: st.getText(sf), scope });
  }
  return ops;
}

// --- Zod-схемы из исходников ---

function resolveModule(scope: FileScope, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(scope.srcRoot, spec.slice(2)) : spec.startsWith('.') ? resolve(scope.dir, spec) : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(c)) return c;
  return null;
}

async function importName(scope: FileScope, name: string): Promise<unknown> {
  const spec = scope.imports.get(name);
  const file = spec ? resolveModule(scope, spec) : null;
  if (!file) return undefined;
  try {
    const mod = (await import(file)) as Record<string, unknown>;
    return mod[name];
  } catch {
    // модуль тянет окружение (БД, env) — берём числовую/строковую константу прямо из текста
    const m = new RegExp(`export const ${name}\\b[^=]*=\\s*(\\d[\\d_]*|'[^']*')\\s*;`).exec(readFileSync(file, 'utf8'));
    if (m) return Function(`return ${m[1]!.replace(/_/g, '')}`)();
    return undefined;
  }
}

async function evalName(scope: FileScope, name: string, seen = new Set<string>()): Promise<unknown> {
  if (scope.cache.has(name)) return scope.cache.get(name);
  let value: unknown;
  const src = scope.locals.get(name);
  if (src !== undefined && /^z\b/.test(src.trimStart()) && !seen.has(name)) {
    seen.add(name);
    const env: Record<string, unknown> = { z };
    // свободные идентификаторы: локальные константы и импорты, остальное найдёт сама JS (Number, String…)
    for (const id of new Set(src.match(/\b[A-Za-z_]\w*\b/g) ?? [])) {
      if (id === 'z' || id in env) continue;
      if (scope.locals.has(id) || scope.imports.has(id)) env[id] = await evalName(scope, id, seen);
    }
    try {
      value = Function(...Object.keys(env), `return (${src});`)(...Object.values(env));
    } catch {
      value = undefined;
    }
  } else if (src !== undefined && /^\/|^\d|^'/.test(src.trim())) {
    value = Function(`return ${src}`)();
  } else if (scope.imports.has(name)) {
    value = await importName(scope, name);
  }
  scope.cache.set(name, value);
  return value;
}

function isZod(v: unknown): v is z.ZodType {
  return typeof v === 'object' && v !== null && '_zod' in v;
}

export function toJson(schema: z.ZodType): JsonSchema {
  const js = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema;
  delete js.$schema;
  return js;
}

interface Found {
  name: string;
  schema: z.ZodType;
  imported: boolean;
}

async function schemaUsed(op: RouteOp, re: RegExp): Promise<Found | null> {
  const m = re.exec(op.text);
  if (!m) return null;
  const name = m[1]!;
  const v = await evalName(op.scope, name);
  return isZod(v) ? { name, schema: v, imported: op.scope.imports.has(name) } : null;
}

// --- сборка ---

const SEC_COOKIE = [{ cookieAuth: [] }];

function roleOf(op: RouteOp): Role {
  if (/\brequireEmployer\(/.test(op.text)) return 'employer';
  if (/\brequireCandidate\(/.test(op.text)) return 'candidate';
  if (/\brequireUser\(/.test(op.text)) return 'user';
  if (/\bgetSession\(req\)[^\n]*unauthorized|!getSession\(/.test(op.text)) return 'session';
  return 'public';
}

const ROLE_TEXT: Record<Role, string> = {
  public: 'Вход не нужен.',
  candidate: 'Нужна сессия кандидата (кука cid).',
  employer: 'Нужна сессия работодателя (кука cid).',
  user: 'Нужна сессия аккаунта любой роли (кука cid).',
  session: 'Нужна любая сессия (кука cid).',
};

function successStatuses(op: RouteOp): number[] {
  const found = new Set<number>();
  for (const m of op.text.matchAll(/status:\s*([^}\n)]+)/g)) {
    for (const n of m[1]!.matchAll(/\b(2\d\d)\b/g)) found.add(Number(n[1]));
  }
  return found.size ? [...found].sort() : [200];
}

function firstLine(doc: string): string {
  let line = (doc.split('\n').find((l) => l.trim()) ?? '').trim();
  // «POST /api/x?a=&b= {тело} — смысл» → «Смысл»
  line = line.replace(/^(?:GET|POST|PUT|PATCH|DELETE)(?:\/[A-Z]+)*\s+\/api\S*\s*/, '');
  line = line.replace(/^(?:\{[^}]*\}|`[^`]*`|\([^)]*\))\s*/, '').replace(/^(?:—|-)\s*/, '');
  return line ? line[0]!.toUpperCase() + line.slice(1) : '';
}

function tagOf(path: string): string {
  const seg = path.split('/')[2] ?? 'misc';
  return seg;
}

function errRef(status: number) {
  return { $ref: `#/components/responses/${ERROR_RESPONSES[status]!.name}` };
}

export interface BuildOptions {
  /** Корень platform/ (по умолчанию cwd). */
  root?: string;
}

export async function buildSpec(opts: BuildOptions = {}): Promise<Record<string, unknown>> {
  const root = opts.root ?? process.cwd();
  const srcRoot = join(root, 'src');
  const apiRoot = join(srcRoot, 'app/api');
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string };

  const files = walk(apiRoot).filter((f) => !isDevRoute(apiRoot, f));
  const ops = files.flatMap((f) => parseRoute(f, apiRoot, srcRoot));
  const componentSchemas: Record<string, JsonSchema> = { ...COMPONENT_SCHEMAS };
  const paths: Record<string, Record<string, unknown>> = {};
  const usedTags = new Set<string>();
  const usedStatuses = new Set<number>();

  const named = (f: Found): JsonSchema => {
    const js = toJson(f.schema);
    if (!f.imported) return js;
    componentSchemas[f.name] = js;
    return { $ref: `#/components/schemas/${f.name}` };
  };

  for (const op of ops.sort((a, b) => a.path.localeCompare(b.path) || METHODS.indexOf(a.method) - METHODS.indexOf(b.method))) {
    const key = `${op.method} ${op.path}`;
    const ov: OpOverride = OVERRIDES[key] ?? {};
    const role = ov.role ?? roleOf(op);
    const tag = ov.tag ?? tagOf(op.path);
    usedTags.add(tag);

    const parameters: Record<string, unknown>[] = [];
    let zodQuery = false;
    for (const p of op.path.matchAll(/\{(\w+)\}/g)) {
      parameters.push({ name: p[1], in: 'path', required: true, schema: ov.pathParams?.[p[1]!] ?? { type: 'string' } });
    }

    // query: явное описание, иначе Zod-схема, иначе имена из searchParams.get('x')
    if (ov.query) {
      for (const q of ov.query) {
        parameters.push({ name: q.name, in: 'query', required: q.required ?? false, ...(q.description ? { description: q.description } : {}), schema: q.schema ?? { type: 'string' } });
      }
    } else {
      const q = await schemaUsed(op, /\b([A-Za-z_]\w*)\.(?:safeParse|parse)\(\s*Object\.fromEntries\(/);
      const qjs = q ? toJson(q.schema) : null;
      if (qjs?.properties) {
        zodQuery = true;
        const req = new Set<string>((qjs.required as string[] | undefined) ?? []);
        for (const [name, schema] of Object.entries(qjs.properties as Record<string, JsonSchema>)) {
          parameters.push({ name, in: 'query', required: req.has(name), schema });
        }
      } else {
        for (const m of op.text.matchAll(/searchParams\.get\('(\w+)'\)/g)) {
          if (!parameters.some((p) => p.name === m[1])) parameters.push({ name: m[1], in: 'query', required: false, schema: { type: 'string' } });
        }
      }
    }

    // тело запроса
    let requestBody: Record<string, unknown> | undefined;
    if (ov.body) {
      requestBody = { required: true, description: ov.body.description, content: { [ov.body.contentType ?? 'application/json']: { schema: ov.body.schema } } };
    } else if (op.method !== 'GET' && op.method !== 'DELETE') {
      const b = await schemaUsed(op, /\b([A-Za-z_]\w*)\.(?:safeParse|parse)\(\s*await req\.json/);
      if (b) requestBody = { required: true, content: { 'application/json': { schema: named(b) } } };
    }

    const text = op.text;
    const statuses = ov.success?.status ? [ov.success.status] : successStatuses(op);
    const redirectOnly = /\.redirect\(/.test(text) && !/Response\.json\(|new Response\(|NextResponse\.json\(/.test(text);
    const sse = /text\/event-stream/.test(text);

    const responses: Record<string, unknown> = {};
    const okDesc = ov.success?.description ?? (firstLine(op.doc) || 'Успешный ответ');
    if (redirectOnly) {
      responses['303'] = { description: ov.success?.description ?? 'Редирект (303)', headers: { Location: { schema: { type: 'string' } } } };
    } else if (sse) {
      responses['200'] = {
        description: ov.success?.description ?? 'Поток событий SSE: кадры `data: <json>\\n\\n`, последним приходит `done`',
        ...(/x-conversation-id/i.test(text) ? { headers: { 'X-Conversation-Id': { schema: { type: 'string' }, description: 'Идентификатор разговора' } } } : {}),
        content: { 'text/event-stream': { schema: ov.success?.schema ?? { type: 'string' } } },
      };
    } else {
      for (const st of statuses) {
        const schema = ov.success?.schema ?? { type: 'object', additionalProperties: true };
        responses[String(st)] = {
          description: st === 201 && !ov.success?.description ? `Создано. ${okDesc}` : okDesc,
          content: { [ov.success?.contentType ?? 'application/json']: { schema } },
        };
      }
    }
    for (const x of ov.success?.extra ?? []) {
      const content = x.schema ? { [x.contentType ?? 'application/json']: { schema: x.schema } } : undefined;
      const prev = responses[String(x.status)] as { description: string; content?: Record<string, unknown> } | undefined;
      if (prev) {
        // тот же статус, другой формат тела (например, JSON вместо PDF): добавляем вариант содержимого
        prev.description = `${prev.description}. ${x.description}`;
        if (content) prev.content = { ...prev.content, ...content };
      } else {
        responses[String(x.status)] = { description: x.description, ...(content ? { content } : {}) };
      }
    }

    // ошибки: выводятся из исходника, подробности (коды `busy`, `blocked_url` …) — из overrides
    const errs = new Set<number>(Object.keys(ov.errors ?? {}).map(Number));
    if (requestBody || zodQuery || /\.parse\(|badRequest\(/.test(text)) errs.add(400);
    if (role !== 'public') errs.add(401);
    if (role === 'candidate' || role === 'employer' || /assertSameOrigin\(|forbidden\(/.test(text)) errs.add(403);
    if (/\{\w+\}/.test(op.path) || /notFound\(/.test(text)) errs.add(404);
    if (/\b409\b|conflict\(/.test(text)) errs.add(409);
    if (/payloadTooLarge\(/.test(text)) errs.add(413);
    if (/unsupported_media_type/.test(text)) errs.add(415);
    if (/rateLimited\(|\b429\b/.test(text)) errs.add(429);
    errs.add(500);
    for (const st of [...errs].sort((a, b) => a - b)) {
      usedStatuses.add(st);
      const detail = ov.errors?.[st];
      responses[String(st)] = detail
        ? { description: detail, content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } }
        : errRef(st);
    }

    const doc = op.doc
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(?:GET|POST|PUT|PATCH|DELETE)(?:[/ ][A-Z]+)*\s+\/api\S*[^—]{0,80}?—\s*/, '');
    const operation: Record<string, unknown> = {
      operationId: ov.operationId ?? `${op.method.toLowerCase()}${op.path
        .split('/')
        .filter((s) => s && s !== 'api')
        .map((s) => s.replace(/[{}]/g, '').replace(/(^|-)(\w)/g, (_m, _d, c: string) => c.toUpperCase()))
        .map((s) => s[0]!.toUpperCase() + s.slice(1))
        .join('')}`,
      tags: [tag],
      summary: ov.summary ?? (firstLine(op.doc).split(/(?<=[.!?])\s/)[0] || key),
      description: [ov.description ?? doc, ROLE_TEXT[role]].filter(Boolean).join('\n\n'),
      ...(role === 'public' ? { security: [] } : { security: SEC_COOKIE }),
      ...(parameters.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses,
    };
    if (ov.optionalAuth) operation.security = [{}, ...SEC_COOKIE];
    (paths[op.path] ??= {})[op.method.toLowerCase()] = operation;
  }

  const responsesComponent: Record<string, unknown> = {};
  for (const st of [...usedStatuses].sort((a, b) => a - b)) {
    const e = ERROR_RESPONSES[st]!;
    responsesComponent[e.name] = { description: e.description, content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } } };
  }

  const tags = [...usedTags].sort().map((name) => ({ name, description: TAG_DESCRIPTIONS[name] ?? name }));

  return {
    openapi: '3.1.0',
    info: {
      title: 'ФСП Карьера - API платформы',
      version: pkg.version ?? '0.0.0',
      description: [
        'REST API платформы подбора ИТ-специалистов (ТЗ ФСП, R-N-06). Файл сгенерирован из кода (`platform/scripts/build-openapi.ts`), руками не править.',
        'Вход — подписанная кука `cid` (HttpOnly, SameSite=Lax); выставляется входом через Яндекс ID, демо-входом или сбросом на онбординг. Изменяющие запросы проверяются на Origin (CSRF): чужой Origin → 403.',
        'Все ошибки имеют единый формат `{ error: { code, message, details? } }` и HTTP-статус; `code` — машинный код (`validation_failed`, `unauthorized`, `session_stale`, `busy` …).',
        'Служебные маршруты `/api/dev/*` (только для разработки) в спецификацию не входят.',
        SSE_EVENTS_DOC,
      ].join('\n\n'),
    },
    servers: [{ url: '/', description: 'Тот же origin, что и интерфейс' }],
    tags,
    paths,
    components: {
      securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'cid', description: 'Подписанная сессионная кука платформы' } },
      schemas: Object.fromEntries(Object.entries(componentSchemas).sort(([a], [b]) => a.localeCompare(b))),
      responses: responsesComponent,
    },
  };
}
