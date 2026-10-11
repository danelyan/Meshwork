import { timingSafeEqual } from 'node:crypto';
import http from 'node:http';

import { runRequestSchema } from './contract';
import type { RunnerConfig } from './config';
import { JobManager, RunnerError } from './jobs';

/**
 * HTTP API runner (контракт – contract.ts, ADR 0003):
 *   GET  /health            без токена → {ok, mode, configured, queued, running}
 *   POST /uploads           тело .tar.gz (≤ 50 МБ) → 201 {uploadId, bytes, sha256}
 *   POST /run               JSON RunRequest → 202 {jobId}
 *   GET  /run/{jobId}       → RunResult
 * Всё, кроме /health: `Authorization: Bearer <RUNNER_TOKEN>`.
 */

const MAX_JSON = 16 * 1024;

function send(res: http.ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(text);
}

const fail = (res: http.ServerResponse, status: number, error: string, message: string) => send(res, status, { error, message });

export function tokenMatches(expected: string | undefined, header: string | undefined): boolean {
  if (!expected || !header) return false;
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) return false;
  const a = Buffer.from(m[1]!);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_JSON) throw new RunnerError('payload_too_large', 'Слишком большой JSON', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new RunnerError('bad_request', 'Тело – не JSON', 400);
  }
}

export function createRunnerServer(cfg: RunnerConfig, jobs: JobManager): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://runner');
    try {
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true, mode: cfg.local ? 'local' : 'container', configured: Boolean(cfg.token), ...jobs.stats() });
      }
      if (!cfg.token) return fail(res, 503, 'runner_not_configured', 'RUNNER_TOKEN не задан');
      if (!tokenMatches(cfg.token, req.headers.authorization)) return fail(res, 401, 'unauthorized', 'Нужен Bearer RUNNER_TOKEN');

      if (req.method === 'POST' && url.pathname === '/uploads') {
        const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
        if (!['application/gzip', 'application/x-gzip', 'application/octet-stream'].includes(type)) {
          return fail(res, 415, 'unsupported_media_type', 'Ожидается application/gzip');
        }
        const len = req.headers['content-length'] ? Number(req.headers['content-length']) : undefined;
        return send(res, 201, await jobs.receiveUpload(req, Number.isFinite(len) ? len : undefined));
      }
      if (req.method === 'POST' && url.pathname === '/run') {
        const parsed = runRequestSchema.safeParse(await readJson(req));
        if (!parsed.success) {
          return fail(res, 400, 'validation', parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
        }
        return send(res, 202, await jobs.submit(parsed.data));
      }
      const m = /^\/run\/([0-9a-f]{32})$/.exec(url.pathname);
      if (req.method === 'GET' && m) {
        const result = jobs.get(m[1]!);
        return result ? send(res, 200, result) : fail(res, 404, 'job_not_found', 'Задание не найдено (рестарт runner очищает очередь)');
      }
      return fail(res, 404, 'not_found', 'Нет такого маршрута');
    } catch (err) {
      if (err instanceof RunnerError) {
        if (!res.headersSent) fail(res, err.status, err.code, err.message);
        req.resume();
        return;
      }
      console.error('runner: unhandled', err);
      if (!res.headersSent) fail(res, 500, 'internal', 'Внутренняя ошибка runner');
    }
  });
}
