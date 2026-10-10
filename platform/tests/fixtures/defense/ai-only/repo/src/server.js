import { createServer } from 'node:http';

import { LinkService } from './links.js';

const MAX_BODY = 4096;

export function createApp(service = new LinkService()) {
  return createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/links') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          res.writeHead(400).end(JSON.stringify({ error: 'bad_json' }));
          return;
        }
        const result = service.shorten(parsed.url);
        if (!result.ok) {
          res.writeHead(422).end(JSON.stringify({ error: result.error }));
          return;
        }
        res.writeHead(result.reused ? 200 : 201, { 'content-type': 'application/json' }).end(JSON.stringify({ code: result.code }));
      });
      return;
    }
    if (req.method === 'GET' && req.url.length > 1) {
      const target = service.resolve(req.url.slice(1));
      if (!target) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(302, { location: target }).end();
      return;
    }
    res.writeHead(404).end();
  });
}
