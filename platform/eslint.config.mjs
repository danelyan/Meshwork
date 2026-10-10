import { FlatCompat } from '@eslint/eslintrc';

// Конфиг по документации Next.js 15 (FlatCompat + next/core-web-vitals + next/typescript).
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  { ignores: ['.next/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'next-env.d.ts', 'project-templates/**'] },
  ...compat.config({ extends: ['next/core-web-vitals', 'next/typescript'] }),
];

export default eslintConfig;
