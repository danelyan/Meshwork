import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSpec } from '../../../scripts/openapi/build';
import { parseYaml, toYaml } from '../../../scripts/openapi/yaml';
import { OPENAPI_JSON, OPENAPI_YAML } from '@/server/openapi/spec.generated';

// R-N-06: все методы описаны через OpenAPI. Спецификация генерируется из кода (scripts/build-openapi.ts);
// после добавления или изменения маршрута: `npx tsx scripts/build-openapi.ts`.
const root = process.cwd();
const apiRoot = path.join(root, 'src/app/api');
const yamlFile = path.join(root, '../docs/openapi.yaml');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

interface Op {
  tags: string[];
  responses: Record<string, { $ref?: string; content?: Record<string, unknown> }>;
  security?: unknown[];
}
interface Spec {
  openapi: string;
  paths: Record<string, Record<string, Op>>;
  components: { securitySchemes: Record<string, unknown>; schemas: Record<string, { required?: string[] }>; responses: Record<string, unknown> };
}

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (n === 'route.ts') out.push(p);
  }
  return out;
}

const spec = JSON.parse(OPENAPI_JSON) as Spec;
const ops = Object.entries(spec.paths).flatMap(([p, m]) => Object.entries(m).map(([method, op]) => ({ key: `${method.toUpperCase()} ${p}`, op })));

describe('спецификация OpenAPI', () => {
  it('YAML разбирается и совпадает с JSON из того же генератора', () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(parseYaml(OPENAPI_YAML)).toEqual(spec);
    expect(toYaml(spec as unknown as Record<string, unknown>)).toBe(OPENAPI_YAML);
  });

  it('независимый разбор YAML (js-yaml, если он есть в node_modules) даёт тот же документ', async () => {
    let load: ((s: string) => unknown) | undefined;
    try {
      const name = 'js-yaml';
      load = ((await import(/* @vite-ignore */ name)) as unknown as { load: (s: string) => unknown }).load;
    } catch {
      return; // js-yaml не зависимость проекта: проверка опциональна
    }
    expect(load(OPENAPI_YAML)).toEqual(spec);
  });

  it('есть cookie-схема безопасности и общий формат ошибки', () => {
    expect(spec.components.securitySchemes.cookieAuth).toMatchObject({ type: 'apiKey', in: 'cookie', name: 'cid' });
    expect(spec.components.schemas.ErrorBody).toBeTruthy();
    for (const k of ['BadRequest', 'Unauthorized', 'Forbidden', 'NotFound', 'Conflict', 'TooManyRequests', 'InternalError']) {
      expect(spec.components.responses[k], k).toBeTruthy();
    }
  });

  it('каждый route.ts (кроме api/dev) представлен всеми экспортированными методами, лишних операций нет', () => {
    const expected = new Set<string>();
    for (const f of routeFiles(apiRoot)) {
      const rel = path.relative(apiRoot, path.dirname(f)).split(path.sep).filter(Boolean);
      if (rel[0] === 'dev') continue;
      const apiPath = '/api' + (rel.length ? '/' + rel.map((s) => s.replace(/^\[(.+)\]$/, '{$1}')).join('/') : '');
      const src = readFileSync(f, 'utf8');
      for (const m of METHODS) {
        if (new RegExp(`^export (?:const|async function|function) ${m}\\b`, 'm').test(src)) expected.add(`${m} ${apiPath}`);
      }
    }
    expect(expected.size).toBeGreaterThan(40);
    expect(new Set(ops.map((o) => o.key))).toEqual(expected);
    expect(Object.keys(spec.paths).some((p) => p.startsWith('/api/dev'))).toBe(false);
  });

  it('у каждой операции есть успешный ответ и хотя бы один код ошибки; ссылки на компоненты существуют', () => {
    for (const { key, op } of ops) {
      const codes = Object.keys(op.responses).map(Number);
      expect(codes.some((c) => c >= 200 && c < 400), `${key}: успешный ответ`).toBe(true);
      expect(codes.some((c) => c >= 400), `${key}: код ошибки`).toBe(true);
      expect(op.tags.length, `${key}: тег`).toBe(1);
    }
    const text = JSON.stringify(spec);
    for (const m of text.matchAll(/"\$ref":"#\/components\/(schemas|responses)\/([^"]+)"/g)) {
      const bucket = spec.components[m[1] as 'schemas' | 'responses'];
      expect(bucket[m[2]!], m[0]).toBeTruthy();
    }
  });

  it('SSE-эндпоинты отдают text/event-stream, остальные JSON-операции событий не заявляют', () => {
    const sse = ops.filter((o) => String(JSON.stringify(o.op.responses['200'])).includes('text/event-stream')).map((o) => o.key);
    expect(sse.sort()).toEqual(['GET /api/call/{id}/events', 'GET /api/defense-room/{id}/events', 'POST /api/consultant/messages', 'POST /api/employer/assistant/messages']);
    expect(spec.components.schemas.ConsultantEvent).toBeTruthy();
    expect(spec.components.schemas.CallEvent).toBeTruthy();
    expect(spec.components.schemas.EmployerEvent).toBeTruthy();
  });

  it('тела запросов берутся из Zod-схем маршрутов: обязательные поля совпадают с кодом', () => {
    const inv = spec.paths['/api/employer/invitations']!.post as unknown as { requestBody: { content: { 'application/json': { schema: { $ref: string } } } } };
    expect(inv.requestBody.content['application/json'].schema.$ref).toBe('#/components/schemas/InvitationInput');
    expect(spec.components.schemas.InvitationInput!.required).toEqual(expect.arrayContaining(['candidateId', 'message', 'salaryFrom', 'salaryTo']));
    const start = spec.paths['/api/test/start']!.post as unknown as { requestBody: { content: { 'application/json': { schema: { properties: Record<string, { enum: string[] }> } } } } };
    expect(start.requestBody.content['application/json'].schema.properties.grade!.enum).toEqual(['junior', 'middle']);
  });
});

describe('актуальность спецификации', () => {
  it('docs/openapi.yaml и spec.generated.ts совпадают с тем, что генерируется из кода маршрутов', async () => {
    const fresh = toYaml(await buildSpec({ root }));
    expect(existsSync(yamlFile)).toBe(true);
    expect(readFileSync(yamlFile, 'utf8'), 'docs/openapi.yaml устарел: npx tsx scripts/build-openapi.ts').toBe(fresh);
    expect(OPENAPI_YAML, 'spec.generated.ts устарел: npx tsx scripts/build-openapi.ts').toBe(fresh);
  }, 60_000);
});
