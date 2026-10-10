// PLATFORM-OWNED: фиксированный конфиг проверки. Конфиги кандидата (vitest/vite/postcss) не читаются:
// runner передаёт --config на этот файл и --root на репозиторий (root только из конфига vitest 4 не
// подхватывает); пути — через переменные окружения задания.
const env = process.env;

const config = {
  root: env.FSP_REPO_DIR,
  cacheDir: env.FSP_CACHE_DIR,
  envDir: env.FSP_CACHE_DIR,
  logLevel: 'warn',
  clearScreen: false,
  css: { postcss: { plugins: [] } },
  server: { watch: null },
  test: {
    include: ['.platform-tests/**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx}'],
    environment: env.FSP_TEST_ENV === 'jsdom' ? 'jsdom' : 'node',
    globals: false,
    watch: false,
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    testTimeout: 10_000,
    hookTimeout: 10_000,
    passWithNoTests: false,
    setupFiles: [],
    globalSetup: [],
    // default — человекочитаемый журнал (logTail, вывод console кандидата); json — машинный отчёт.
    reporters: ['default', 'json'],
    outputFile: { json: env.FSP_REPORT_FILE },
  },
};

export default config;
