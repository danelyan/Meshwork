import { createKeycloakVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { Registry } from './data.js';
import { registerRoutes } from './handlers.js';
import { createHttpServer, Router } from './http.js';

const config = loadConfig();
const registry = Registry.load(config.dataFile);
const router = new Router();
registerRoutes(router, { registry, verify: createKeycloakVerifier(config), config });

const log = (line: string) => console.log(`[fsp-sim ${new Date().toISOString()}] ${line}`);
const server = createHttpServer(router, log);
server.listen(config.port, () => {
  log(`API реестра ФСП (симулятор) слушает :${config.port}; issuer ${config.issuer}; набор ${JSON.stringify(registry.stats())}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log(`${sig}: остановка`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
