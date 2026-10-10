import { verifySignature } from './signature.js';

// Принимает вебхук партнёра, проверяет подпись и ставит пересылку во внутренний сервис в очередь.
export function createRelay({ secret, queue, clock = () => Math.floor(Date.now() / 1000) }) {
  return function handle(req) {
    const check = verifySignature({ secret, header: req.headers['x-signature'], rawBody: req.rawBody, nowSec: clock() });
    if (!check.ok) return { status: 401, body: { error: check.reason } };
    let event;
    try {
      event = JSON.parse(req.rawBody);
    } catch {
      return { status: 400, body: { error: 'bad_json' } };
    }
    if (typeof event.id !== 'string') return { status: 422, body: { error: 'no_event_id' } };
    const accepted = queue.enqueue(event);
    return { status: 202, body: { accepted } };
  };
}
