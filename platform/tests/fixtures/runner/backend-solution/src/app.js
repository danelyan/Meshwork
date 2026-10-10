import { randomUUID } from 'node:crypto';

// Эталонное решение шаблона backend-junior-api (фикстура тестов runner).
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createApp() {
  const notes = new Map();
  return (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok' });
    if (req.method === 'POST' && url.pathname === '/notes') {
      let raw = '';
      req.setEncoding('utf8');
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        let data;
        try {
          data = JSON.parse(raw);
        } catch {
          return send(res, 400, { error: 'validation' });
        }
        const title = typeof data?.title === 'string' ? data.title.trim() : '';
        if (!title || title.length > 200) return send(res, 400, { error: 'validation' });
        const note = { id: randomUUID(), title, body: typeof data.body === 'string' ? data.body : '', createdAt: new Date().toISOString() };
        notes.set(note.id, note);
        send(res, 201, note);
      });
      return;
    }
    const m = /^\/notes\/([^/]+)$/.exec(url.pathname);
    if (req.method === 'GET' && m) {
      const note = notes.get(decodeURIComponent(m[1]));
      return note ? send(res, 200, note) : send(res, 404, { error: 'not_found' });
    }
    send(res, 404, { error: 'not_found' });
  };
}
