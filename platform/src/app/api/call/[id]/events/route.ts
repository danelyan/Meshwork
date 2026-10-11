import { callPrincipal, encodeCallEvent, eventForAccess, getCallForViewer, subscribeCall } from '@/server/call';
import { errors, withErrors } from '@/server/errors';
import { getSession } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Пинг-комментарий, чтобы прокси (Caddy) не закрыл тихое соединение. */
const HEARTBEAT_MS = 15_000;

/**
 * GET /api/call/{id}/events – поток событий созвона (SSE, `text/event-stream`): первым `snapshot`,
 * дальше `utterance`, `status`, `ai_state`, `participant`, `mute`, `question`, `verdict`, `signal`, `error`.
 * Кадр – `event: <type>` + `data: <json>`. Работодатель без доступа к записи получает только статус и оценки.
 */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
  if (!getSession(req)) throw errors.unauthorized();
  const who = callPrincipal(req);
  const { id } = await params;
  const { view, access } = await getCallForViewer(who, id);
  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(enc.encode(chunk));
        } catch {
          cleanup();
        }
      };
      send(encodeCallEvent({ type: 'snapshot', call: view }));
      const unsubscribe = subscribeCall(id, (ev) => {
        // Работодатель без доступа к записи – только статус, участники и вердикт без цитат.
        const out = eventForAccess(ev, access.access);
        if (out) send(encodeCallEvent(out));
      });
      const timer = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(timer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* уже закрыт */
        }
      };
      req.signal.addEventListener('abort', () => cleanup(), { once: true });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  });
});
