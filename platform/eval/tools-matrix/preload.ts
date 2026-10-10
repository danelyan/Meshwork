// `server-only` подставляет Next.js; вне него пакета нет (в vitest — alias, vitest.config.mts). Здесь — то же самое для tsx.
// Импортировать первым, до модулей из src/.
import Module from 'node:module';
import { join } from 'node:path';

const empty = join(process.cwd(), 'node_modules/next/dist/compiled/server-only/empty.js');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const M = Module as any;
const orig = M._resolveFilename;
M._resolveFilename = function (request: string, ...rest: unknown[]) {
  return request === 'server-only' ? empty : orig.call(this, request, ...rest);
};
