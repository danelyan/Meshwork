import { loadConfig } from './config';
import { JobManager } from './jobs';
import { isContainerMode, isRoot } from './sandbox';
import { createRunnerServer } from './server';

/** Точка входа сервиса runner: `node dist/server.mjs` в контейнере, `npx tsx runner/src/main.ts` локально. */
async function main() {
  const cfg = loadConfig();
  if (!cfg.local && !isContainerMode(cfg)) {
    console.error('runner: контейнерный режим требует Linux и RUNNER_SANDBOX_HELPER (setuid-помощник). Локально — RUNNER_LOCAL=1');
    process.exit(1);
  }
  if (isRoot()) {
    // Решение владельца: сервис не работает от root; uid задания меняет только помощник.
    console.error('runner: запуск от root запрещён — нужен непривилегированный uid (в образе — runner, 1001)');
    process.exit(1);
  }
  if (cfg.local) console.warn('runner: RUNNER_LOCAL=1 — задания под текущим пользователем; изоляция неполная, только для разработки');
  if (!cfg.token) console.warn('runner: RUNNER_TOKEN не задан — API отвечает 503');
  const jobs = new JobManager(cfg);
  await jobs.init();
  const server = createRunnerServer(cfg, jobs);
  server.requestTimeout = 120_000;
  server.listen(cfg.port, cfg.host, () => console.log(`runner: слушает ${cfg.host}:${cfg.port} (${cfg.local ? 'local' : 'container'})`));
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

void main();
