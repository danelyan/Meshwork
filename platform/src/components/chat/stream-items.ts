/**
 * Сборка ленты из событий SSE со стримом (docs/platform.md, «События SSE»): `delta` дописывает
 * реплику с тем же id (или заводит новую, `streaming`), `message` с id фиксирует её авторитетным
 * текстом, `discard` убирает показанное. `message` без дельт (старый сервер, восстановление)
 * становится обычной репликой, живой – с плавным раскрытием (`live`).
 */
type StreamEvent =
  | { type: 'delta'; id: string; text: string }
  | { type: 'discard'; id: string }
  | { type: 'message'; text: string; id?: string };

export interface AgentItem<E> {
  id: string;
  role: 'agent';
  event: E;
  /** Пришло вживую в этой вкладке – раскрывать плавно (история рисуется сразу). */
  live?: boolean;
  /** Дельты ещё идут. */
  streaming?: boolean;
  /** id реплики на сервере (связь delta ↔ message). */
  streamId?: string;
}

export function applyAgentEvent<E extends { type: string }, I extends { id: string; role: string }>(
  items: (I | AgentItem<E>)[],
  event: E,
  nextId: () => string,
): (I | AgentItem<E>)[] {
  const ev = event as unknown as StreamEvent;
  const find = (sid: string) => items.findIndex((it) => it.role === 'agent' && (it as AgentItem<E>).streamId === sid);
  if (ev.type === 'delta') {
    const i = find(ev.id);
    if (i === -1) {
      const item: AgentItem<E> = { id: nextId(), role: 'agent', event: { type: 'message', text: ev.text } as unknown as E, live: true, streaming: true, streamId: ev.id };
      return [...items, item];
    }
    const cur = items[i] as AgentItem<E>;
    const text = (cur.event as unknown as { text: string }).text + ev.text;
    const next = items.slice();
    next[i] = { ...cur, event: { ...cur.event, text } };
    return next;
  }
  if (ev.type === 'discard') {
    const i = find(ev.id);
    return i === -1 ? items : items.filter((_, k) => k !== i);
  }
  if (ev.type === 'message' && ev.id) {
    const i = find(ev.id);
    if (i !== -1) {
      const cur = items[i] as AgentItem<E>;
      const next = items.slice();
      next[i] = { ...cur, event: { ...cur.event, text: ev.text }, streaming: false };
      return next;
    }
  }
  return [...items, { id: nextId(), role: 'agent', event, live: true }];
}
