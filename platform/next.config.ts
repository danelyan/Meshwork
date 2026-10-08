import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Штатная сборка для Docker (docs: next.config.js/output).
  output: 'standalone',
  // Нативные/тяжёлые серверные пакеты — без бандлинга, через require Node.js
  // (docs: next.config.js/serverExternalPackages).
  serverExternalPackages: ['unpdf', 'mammoth'],
  poweredByHeader: false,
  // Промпты defense/claims читаются с диска через process.cwd() — трассировщик их
  // не видит, без этого standalone-сборка останется без промптов. Ключ — glob
  // маршрута (picomatch), значение — glob файлов от корня проекта
  // (docs: next.config.js/output, outputFileTracingIncludes).
  outputFileTracingIncludes: {
    '/*': ['./src/server/**/prompts/*.md'],
    '/api/**/*': ['./src/server/**/prompts/*.md'],
  },
};

export default nextConfig;
