import { loadConfig } from './config';
import { JobManager } from './jobs';
import { isRoot } from './sandbox';
import { createRunnerServer } from './server';

/** Точка входа сервиса runner: `node dist/server.mjs` в контейнере, `npx tsx runner/src/main.ts` локально. */
async function main() {
  const cfg = loadConfig();
  if (!cfg.local && !(isRoot() && process.platform === 'linux')) {
    console.error('runner: контейнерный режим требует Linux и root (для смены uid задания). Локально — RUNNER_LOCAL=1');
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
