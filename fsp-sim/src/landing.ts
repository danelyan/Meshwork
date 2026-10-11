import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Config } from './config.js';

/** Стартовая страница стенда — статические файлы из каталога `public/`, читаются один раз при старте. */
export function loadStartPage(dir: string): { html: string; css: string; js: string } {
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  return { html: read('index.html'), css: read('app.css'), js: read('app.js') };
}

export function renderSwagger(config: Config): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Реестр ФСП — OpenAPI</title>
<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css"></head>
<body><div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
<script>window.ui = SwaggerUIBundle({ url: ${JSON.stringify(`${config.publicUrl}/openapi.json`)}, dom_id: '#swagger-ui', persistAuthorization: true });</script>
</body></html>`;
}
