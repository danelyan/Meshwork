import { createKeycloakVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { Registry } from './data.js';
import { registerRoutes } from './handlers.js';
import { createHttpServer, Router } from './http.js';
import { createKeycloakAdmin } from './idp.js';

const config = loadConfig();
const registry = Registry.load(config.dataFile, config.stateFile);
const idp = createKeycloakAdmin(config);
const router = new Router();
registerRoutes(router, { registry, verify: createKeycloakVerifier(config), config, idp });

const log = (line: string) => console.log(`[fsp-sim ${new Date().toISOString()}] ${line}`);
const server = createHttpServer(router, log);
server.listen(config.port, () => {
  log(`API реестра ФСП (симулятор) слушает :${config.port}; issuer ${config.issuer}; набор ${JSON.stringify(registry.stats())}`);
});

/**
 * Пользователи ФСП ID должны совпадать с участниками реестра и после рестарта, и после пересоздания
 * базы Keycloak. Keycloak стартует дольше API – сверка повторяется, пока он не ответит.
 */
async function syncIdentities(attempt = 1): Promise<void> {
  try {
    const r = await idp.reconcile(registry.dataset.athletes);
    log(`ФСП ID сверен с реестром: создано ${r.created}, обновлено ${r.updated}, удалено ${r.deleted}`);
  } catch {
    if (attempt >= 60) return log('ФСП ID не сверен с реестром: Keycloak не ответил за 10 минут');
    setTimeout(() => void syncIdentities(attempt + 1), 10_000).unref();
  }
}
void syncIdentities();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log(`${sig}: остановка`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
