'use client';

import { useState } from 'react';

import { Button, Notice } from '@/components/ui';

import styles from './api-docs.module.css';

// Внешний ресурс: Swagger UI подгружается с CDN по нажатию кнопки, в зависимости проекта он не входит.
// Без сети остаётся список эндпоинтов выше и сам документ по ссылке.
const VERSION = '5.17.14';
const BASE = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${VERSION}`;

type SwaggerBundle = (cfg: { url: string; dom_id: string; deepLinking?: boolean }) => unknown;

function load(tag: 'link' | 'script', url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(tag);
    if (el instanceof HTMLLinkElement) {
      el.rel = 'stylesheet';
      el.href = url;
    } else if (el instanceof HTMLScriptElement) {
      el.src = url;
    }
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(url));
    document.head.appendChild(el);
  });
}

export function SwaggerUiLoader() {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');

  async function open() {
    setState('loading');
    try {
      await load('link', `${BASE}/swagger-ui.css`);
      await load('script', `${BASE}/swagger-ui-bundle.js`);
      const bundle = (window as unknown as { SwaggerUIBundle?: SwaggerBundle }).SwaggerUIBundle;
      if (!bundle) throw new Error('SwaggerUIBundle');
      bundle({ url: '/api/openapi?format=json', dom_id: '#swagger-ui', deepLinking: true });
      setState('ready');
    } catch {
      setState('failed');
    }
  }

  return (
    <section className={styles.swagger} aria-labelledby="swagger-title">
      <h2 id="swagger-title">Интерактивный просмотр</h2>
      <p>
        Swagger UI загружается с внешнего ресурса cdn.jsdelivr.net (swagger-ui-dist {VERSION}) только по кнопке. Запросы «Try it out» идут на этот же сервер с вашей сессией.
      </p>
      {state !== 'ready' && (
        <Button type="button" onClick={open} loading={state === 'loading'}>
          Открыть в Swagger UI
        </Button>
      )}
      {state === 'failed' && <Notice tone="error">Не удалось загрузить Swagger UI (нет доступа к cdn.jsdelivr.net). Список эндпоинтов выше и файл спецификации работают без него.</Notice>}
      <div id="swagger-ui" className={styles.swaggerHost} />
    </section>
  );
}
