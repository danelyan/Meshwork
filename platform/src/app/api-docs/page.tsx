import type { Metadata } from 'next';

import { Container } from '@/components/shell/Container';
import { Tag } from '@/components/ui';
import { OPENAPI_JSON } from '@/server/openapi/spec.generated';

import styles from './api-docs.module.css';
import { SwaggerUiLoader } from './SwaggerUiLoader';

export const metadata: Metadata = { title: 'Документация API - MESHWORK' };

interface Operation {
  tags?: string[];
  summary?: string;
  responses: Record<string, unknown>;
}
interface Spec {
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, Operation>>;
}

/**
 * Список эндпоинтов из спецификации OpenAPI (R-N-06): работает без сети и без сторонних скриптов.
 * Интерактивный Swagger UI подгружается с CDN по кнопке (внешний ресурс).
 */
export default function ApiDocsPage() {
  const spec = JSON.parse(OPENAPI_JSON) as Spec;
  const groups = spec.tags.map((tag) => ({
    tag,
    ops: Object.entries(spec.paths).flatMap(([path, methods]) =>
      Object.entries(methods)
        .filter(([, op]) => op.tags?.[0] === tag.name)
        .map(([method, op]) => ({ path, method: method.toUpperCase(), op })),
    ),
  }));

  return (
    <main id="main">
      <Container size="default" className={styles.page}>
        <h1>Документация API</h1>
        <p className={styles.lead}>
          Все методы описаны по OpenAPI 3.1: запросы, ответы и коды ошибок. Формат ошибки везде один: <code>{'{ error: { code, message } }'}</code>. Вход — кука сессии.
        </p>
        <div className={styles.links}>
          <a href="/api/openapi">openapi.yaml</a>
          <a href="/api/openapi?format=json">openapi.json</a>
        </div>
        {groups.map(({ tag, ops }) => (
          <section key={tag.name} className={styles.group} aria-labelledby={`tag-${tag.name}`}>
            <h2 id={`tag-${tag.name}`}>{tag.name}</h2>
            <p className={styles.lead}>{tag.description}</p>
            <ul className={styles.list}>
              {ops.map(({ path, method, op }) => (
                <li key={`${method} ${path}`} className={styles.row}>
                  <span className={styles.method}>{method}</span>
                  <span className={styles.path}>{path}</span>
                  <span className={styles.summary}>{op.summary}</span>
                  <span className={styles.codes}>
                    {Object.keys(op.responses).map((code) => (
                      <Tag key={code} tone={code.startsWith('2') || code.startsWith('3') ? 'outline' : 'plain'}>
                        {code}
                      </Tag>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <SwaggerUiLoader />
      </Container>
    </main>
  );
}
