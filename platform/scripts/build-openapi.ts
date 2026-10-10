// Собирает OpenAPI 3.1 из кода маршрутов src/app/api/**/route.ts (кроме api/dev) и пишет:
//   ../docs/openapi.yaml                       — спецификация для людей и внешних инструментов;
//   src/server/openapi/spec.generated.ts       — то же в бандле приложения (GET /api/openapi, /api-docs).
// Запуск из platform/ после любого изменения маршрутов: npx tsx scripts/build-openapi.ts
// Тест tests/unit/api/openapi.test.ts сверяет, что файлы совпадают с кодом.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildSpec } from './openapi/build';
import { toYaml } from './openapi/yaml';

async function main() {
  const root = process.cwd();
  const spec = await buildSpec({ root });
  const yaml = toYaml(spec);
  writeFileSync(join(root, '../docs/openapi.yaml'), yaml);
  const ts = [
    '// Сгенерировано scripts/build-openapi.ts из src/app/api/**/route.ts — руками не править.',
    '// Тот же документ, что docs/openapi.yaml: в standalone-сборке Next.js папки docs нет.',
    '',
    `export const OPENAPI_YAML = ${JSON.stringify(yaml)};`,
    '',
    `export const OPENAPI_JSON = ${JSON.stringify(JSON.stringify(spec))};`,
    '',
  ].join('\n');
  writeFileSync(join(root, 'src/server/openapi/spec.generated.ts'), ts);
  const paths = Object.values(spec.paths as Record<string, object>);
  console.log(`openapi.yaml: ${paths.length} путей, ${paths.reduce((n, p) => n + Object.keys(p).length, 0)} операций`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
