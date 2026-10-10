import { buildSnapshot, encodeCallEvent, redactEvent, redactSnapshot, resolveViewer, subscribe } from '@/server/defense-room';
import type { CallEvent } from '@/server/defense-room';
import { withErrors } from '@/server/errors';
import { getSession } from '@/server/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const KEEPALIVE_MS = 20_000;

/**
 * GET — SSE звонка защиты (EventSource), имена событий — как у лейна call: первым кадром `snapshot`,
 * дальше `utterance`, `ai_state`, `participant`, `mute`, `question`, `status`, `verdict`, `signal`
 * (сигналы WebRTC — только адресату). Каждые 20 с — комментарий-keepalive. Доступ — как у GET снимка.
 * Разрыв соединения клиентом — `request.signal` (docs Next.js: Route Handlers, streaming).
 */
export const GET = withErrors(async (req: Request, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { viewer } = await resolveViewer(getSession(req), id);
  const encoder = new TextEncoder();
  const signal = req.signal;
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };
      const send = (e: CallEvent) => {
        const out = redactEvent(e, viewer);
        if (out) write(encodeCallEvent(out));
      };
      // Подписка до снимка: событие между снимком и подпиской не потеряется (дубли клиент убирает по index).
      const unsubscribe = subscribe(id, viewer.peer, send);
      const timer = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* уже закрыт */
        }
      };
      signal.addEventListener('abort', cleanup, { once: true });
      write('retry: 3000\n\n');
      send({ type: 'snapshot', call: redactSnapshot(await buildSnapshot(id), viewer) });
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});
