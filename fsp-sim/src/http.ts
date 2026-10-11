import http from 'node:http';

/** Ошибка API: статус, машинный код и сообщение для человека. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export interface Ctx {
  req: http.IncomingMessage;
  method: string;
  url: URL;
  params: Record<string, string>;
}

export interface Reply {
  status?: number;
  /** Тело JSON-ответа: заворачивается в `{ data, meta }`. */
  data?: unknown;
  meta?: Record<string, unknown>;
  /** HTML-ответ вместо JSON. */
  html?: string;
  /** Сырой JSON без конверта (OpenAPI). */
  raw?: unknown;
  headers?: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<Reply> | Reply;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler): this {
    const keys: string[] = [];
    const source = path
      .split('/')
      .map((seg) => {
        if (seg.startsWith(':')) {
          keys.push(seg.slice(1));
          return '([^/]+)';
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    this.routes.push({ method, pattern: new RegExp(`^${source}/?$`), keys, handler });
    return this;
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'method_not_allowed' | null {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.pattern.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]!);
      });
      return { handler: r.handler, params };
    }
    return pathMatched ? 'method_not_allowed' : null;
  }
}

const MAX_JSON = 8 * 1024;

export async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
  if (type && type !== 'application/json') throw new ApiError(415, 'unsupported_media_type', 'Ожидается application/json');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_JSON) throw new ApiError(413, 'payload_too_large', 'Слишком большое тело запроса');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'bad_request', 'Тело запроса — не JSON');
  }
}

const BASE_HEADERS = {
  'x-fsp-simulator': 'true',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, PUT, DELETE, OPTIONS',
};

function writeJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
}

export function createHttpServer(router: Router, log: (line: string) => void = () => {}): http.Server {
  return http.createServer(async (req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();
    let url: URL | null = null;
    try {
      // Некорректная цель запроса (например, `//[`) бросает в конструкторе URL — это 400, а не падение процесса.
      try {
        url = new URL(req.url ?? '/', 'http://fsp-sim');
      } catch {
        throw new ApiError(400, 'bad_request', 'Некорректный адрес запроса');
      }
      if (method === 'OPTIONS') {
        res.writeHead(204, BASE_HEADERS);
        res.end();
        return;
      }
      const matched = router.match(method === 'HEAD' ? 'GET' : method, url.pathname);
      if (matched === null) throw new ApiError(404, 'not_found', `Маршрут ${method} ${url.pathname} не существует`);
      if (matched === 'method_not_allowed') throw new ApiError(405, 'method_not_allowed', `Метод ${method} для ${url.pathname} не поддерживается`);
      const reply = await matched.handler({ req, method, url, params: matched.params });
      const status = reply.status ?? 200;
      if (reply.html !== undefined) {
        res.writeHead(status, { ...BASE_HEADERS, 'content-type': 'text/html; charset=utf-8', ...reply.headers });
        res.end(reply.html);
      } else if (reply.raw !== undefined) {
        writeJson(res, status, reply.raw, reply.headers);
      } else if (status === 204) {
        res.writeHead(204, { ...BASE_HEADERS, ...reply.headers });
        res.end();
      } else {
        writeJson(res, status, { data: reply.data ?? null, meta: { simulator: true, ...reply.meta } }, reply.headers);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        writeJson(res, err.status, { error: { code: err.code, message: err.message }, meta: { simulator: true } }, err.headers);
      } else {
        log(`500 ${method} ${url?.pathname ?? req.url}: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
        writeJson(res, 500, { error: { code: 'internal', message: 'Внутренняя ошибка симулятора' }, meta: { simulator: true } });
      }
    }
  });
}
