// Шина событий созвона в памяти процесса: один инстанс приложения на стенде (как лимиты TTS).
// SSE-маршрут подписывается, сервис публикует. Несколько инстансов потребуют Postgres LISTEN/NOTIFY.
import type { CallEvent } from './types';

type Listener = (event: CallEvent) => void;

// На globalThis под Symbol.for: идентичность модуля не гарантирована (в dev маршруты собираются отдельными
// модулями, и /turn публиковал в одну Map, а /events слушал другую — SSE получал только snapshot; отладка 11.10).
// Тот же приём, что у defense-room/bus.ts и у самого Next.js для своих синглтонов.
const KEY = Symbol.for('fsp.call.bus');
const g = globalThis as unknown as Record<symbol, Map<string, Set<Listener>> | undefined>;
const channels: Map<string, Set<Listener>> = (g[KEY] ??= new Map());

export function subscribeCall(sessionId: string, listener: Listener): () => void {
  let set = channels.get(sessionId);
  if (!set) {
    set = new Set();
    channels.set(sessionId, set);
  }
  set.add(listener);
  return () => {
    const cur = channels.get(sessionId);
    if (!cur) return;
    cur.delete(listener);
    if (cur.size === 0) channels.delete(sessionId);
  };
}

/** Разослать событие подписчикам созвона. Ошибка одного подписчика не мешает остальным. */
export function publishCall(sessionId: string, event: CallEvent): void {
  for (const l of channels.get(sessionId) ?? []) {
    try {
      l(event);
    } catch (err) {
      console.warn('[call] listener failed', err instanceof Error ? err.message : err);
    }
  }
}

export function callSubscriberCount(sessionId: string): number {
  return channels.get(sessionId)?.size ?? 0;
}

/** SSE-кадр с именем события: `event: <type>\ndata: <json>\n\n` (U+2028/2029 экранированы). */
export function encodeCallEvent(event: CallEvent): string {
  const json = JSON.stringify(event).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `event: ${event.type}\ndata: ${json}\n\n`;
}
