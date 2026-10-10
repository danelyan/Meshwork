// PLATFORM-OWNED: мок-сервер провайдера доставки на 127.0.0.1 со сценарием ответов.
import { createServer, type IncomingMessage, type Server } from 'node:http';

export interface Scripted {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Задержка ответа, мс (для таймаутов). */
  delayMs?: number;
  /** Оборвать соединение без ответа. */
  destroy?: boolean;
}

export interface Recorded {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}

export interface MockProvider {
  baseUrl: string;
  requests: Recorded[];
  /** Ответы по очереди; когда очередь пуста — последний повторяется. */
  script(path: string, ...responses: Scripted[]): void;
  close(): Promise<void>;
}

export async function startMockProvider(): Promise<MockProvider> {
  const scripts = new Map<string, Scripted[]>();
  const requests: Recorded[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: unknown = raw;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        /* не JSON — сохраняем строкой */
      }
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const queue = scripts.get(req.url ?? '') ?? [];
      const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 404, body: { error: 'no script' } };
      const send = () => {
        if (next.destroy) return req.socket.destroy();
        if (res.destroyed) return;
        res.writeHead(next.status, { 'content-type': 'application/json', ...next.headers });
        res.end(next.body === undefined ? '' : JSON.stringify(next.body));
      };
      if (next.delayMs) setTimeout(send, next.delayMs);
      else send();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('mock: нет адреса');
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    requests,
    script: (path, ...responses) => scripts.set(path, responses),
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
