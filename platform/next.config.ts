import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Штатная сборка для Docker (docs: next.config.js/output).
  output: 'standalone',
  // Нативные/тяжёлые серверные пакеты — без бандлинга, через require Node.js
  // (docs: next.config.js/serverExternalPackages).
  serverExternalPackages: ['unpdf', 'mammoth', 'pdfkit'],
  poweredByHeader: false,
  // Второй локальный dev-сервер из той же папки — со своим каталогом сборки, иначе общий .next ломает оба
  // (docs: next.config.js/distDir). По умолчанию .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Промпты defense/claims читаются с диска через process.cwd() — трассировщик их
  // не видит, без этого standalone-сборка останется без промптов. Ключ — glob
  // маршрута (picomatch), значение — glob файлов от корня проекта
  // (docs: next.config.js/output, outputFileTracingIncludes).
  outputFileTracingIncludes: {
    '/*': ['./src/server/**/prompts/*.md'],
    '/api/**/*': ['./src/server/**/prompts/*.md'],
    // Демо-резюме (PDF) читаются с диска через process.cwd() в /api/demo/resume.
    '/api/demo/resume': ['./src/server/demo/pdf/*.pdf'],
    // Шаблоны проектов (lane project) читаются с диска: условие, заготовка, хеши PLATFORM-OWNED.
    '/api/project-tasks/**': ['./project-templates/**/*'],
    '/api/project-submissions/**': ['./project-templates/**/*'],
    '/api/employer/**': ['./project-templates/**/*'],
    '/employer/needs/**': ['./project-templates/**/*'],
    '/projects/**': ['./project-templates/**/*'],
  },
  // Эталонные решения шаблонов приложению не нужны (docs: outputFileTracingExcludes).
  outputFileTracingExcludes: {
    '/*': ['./project-templates/**/reference/**'],
  },
};

export default nextConfig;
