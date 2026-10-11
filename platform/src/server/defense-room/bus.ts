import type { CallEvent, CallEventName } from './types';

/**
 * Шина событий звонка в памяти процесса: маршруты пишут, SSE-подписчики читают.
 * Стенд – один инстанс Next.js (compose), поэтому межпроцессной шины нет; всё, что должно
 * пережить перезапуск (транскрипт, участники, mute), лежит в БД, а SSE при подключении шлёт
 * снимок `snapshot`. Сигналы WebRTC эфемерны и идут только адресату (`to`).
 * Хранится на globalThis: в dev маршруты собираются отдельными модулями, а шина должна быть одна.
 */

/** Адрес участника: `candidate` или `employer:<userId>`. */
export type PeerId = string;

export const CANDIDATE_PEER: PeerId = 'candidate';
export const employerPeer = (userId: string): PeerId => `employer:${userId}`;

type Listener = (event: CallEvent) => void;

interface Subscriber {
  peer: PeerId;
  listener: Listener;
}

const KEY = Symbol.for('fsp.defense-room.bus');
type Store = Map<string, Set<Subscriber>>;
const g = globalThis as unknown as Record<symbol, Store | undefined>;
const store: Store = (g[KEY] ??= new Map());

export function subscribe(sessionId: string, peer: PeerId, listener: Listener): () => void {
  const set = store.get(sessionId) ?? new Set<Subscriber>();
  const sub: Subscriber = { peer, listener };
  set.add(sub);
  store.set(sessionId, set);
  return () => {
    set.delete(sub);
    if (set.size === 0) store.delete(sessionId);
  };
}

/** Событие всем подписчикам сессии; `signal` – только адресату. */
export function publish(sessionId: string, event: CallEvent): void {
  const set = store.get(sessionId);
  if (!set) return;
  for (const sub of [...set]) {
    if (event.type === 'signal' && sub.peer !== event.to) continue;
    try {
      sub.listener(event);
    } catch {
      /* упавший подписчик не мешает остальным */
    }
  }
}

/** Подключён ли адресат (для сигналов: некуда слать – клиенту 409, он уйдёт в текст). */
export function isConnected(sessionId: string, peer: PeerId): boolean {
  for (const sub of store.get(sessionId) ?? []) if (sub.peer === peer) return true;
  return false;
}

/**
 * SSE-кадр: `event: <имя>` + `data: <json>` (тип продублирован в JSON для парсеров по `data`).
 * U+2028/2029 экранируются, как в agent/events.ts.
 */
export function encodeCallEvent(event: CallEvent): string {
  const name: CallEventName = event.type;
  const json = JSON.stringify(event).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `event: ${name}\ndata: ${json}\n\n`;
}

/** Только для тестов. */
export function resetBus(): void {
  store.clear();
}
