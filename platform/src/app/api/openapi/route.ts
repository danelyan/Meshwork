import { OPENAPI_JSON, OPENAPI_YAML } from '@/server/openapi/spec.generated';

export const dynamic = 'force-dynamic';

/**
 * GET /api/openapi — спецификация OpenAPI 3.1 всех методов API (R-N-06). По умолчанию YAML;
 * `?format=json` или `Accept: application/json` — JSON. Документ сгенерирован из кода (scripts/build-openapi.ts).
 */
export function GET(req: Request) {
  const wantsJson = new URL(req.url).searchParams.get('format') === 'json' || (req.headers.get('accept') ?? '').includes('application/json');
  return new Response(wantsJson ? OPENAPI_JSON : OPENAPI_YAML, {
    headers: { 'content-type': wantsJson ? 'application/json; charset=utf-8' : 'application/yaml; charset=utf-8' },
  });
}
