import { type CallEvent, callPrincipal, encodeCallEvent, getCallForViewer, publicVerdict, subscribeCall } from '@/server/call';
import type { CallVerdict } from '@/server/call';
import { withErrors } from '@/server/errors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Пинг-комментарий, чтобы прокси (Caddy) не закрыл тихое соединение. */
const HEARTBEAT_MS = 15_000;

/** Что видит работодатель без доступа к записи: только статус, участники и оценки. */
const SUMMARY_EVENTS = new Set<CallEvent['type']>(['status', 'participant', 'verdict']);

/**
 * GET /api/call/{id}/events — поток событий созвона (SSE, `text/event-stream`): первым `snapshot`,
 * дальше `utterance`, `status`, `ai_state`, `participant`, `mute`, `question`, `verdict`, `signal`, `error`.
 * Кадр — `event: <type>` + `data: <json>`. Работодатель без доступа к записи получает только статус и оценки.
 */
export const GET = withErrors(async (req: Request, { params }: Ctx) => {
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
        if (access.access === 'summary') {
          if (!SUMMARY_EVENTS.has(ev.type)) return;
          if (ev.type === 'verdict' && 'runs' in ev.verdict) return send(encodeCallEvent({ type: 'verdict', verdict: publicVerdict(ev.verdict as CallVerdict) }));
        }
        send(encodeCallEvent(ev));
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
