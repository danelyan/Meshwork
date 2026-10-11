// `server-only` подставляет Next.js; вне него (tsx) — пустой модуль, как alias в vitest.config.mts.
const Module = require('node:module');
const path = require('node:path');
const empty = path.join(__dirname, '../../../node_modules/next/dist/compiled/server-only/empty.js');
const orig = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'server-only' ? empty : orig.call(this, req, ...rest);
};
