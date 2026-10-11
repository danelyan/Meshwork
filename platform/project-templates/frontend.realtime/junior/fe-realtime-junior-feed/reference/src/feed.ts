export interface Message {
  id: string;
  author: string;
  text: string;
  sentAt: number;
  editedAt?: number;
}

export type FeedEvent =
  | { type: 'message'; message: Message }
  | { type: 'edit'; id: string; text: string; editedAt: number }
  | { type: 'delete'; id: string };

export interface Feed {
  apply(event: FeedEvent): void;
  messages(): Message[];
  unreadCount(): number;
  markRead(): void;
  subscribe(listener: () => void): () => void;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validate(e: unknown): asserts e is FeedEvent {
  const ev = e as Record<string, unknown> | null;
  if (typeof ev !== 'object' || ev === null) throw new TypeError('event must be an object');
  if (ev.type === 'message') {
    const m = ev.message as Record<string, unknown> | null;
    if (typeof m !== 'object' || m === null) throw new TypeError('message required');
    if (!isStr(m.id) || !m.id || !isStr(m.author) || !isStr(m.text) || !isNum(m.sentAt)) throw new TypeError('bad message');
  } else if (ev.type === 'edit') {
    if (!isStr(ev.id) || !ev.id || !isStr(ev.text) || !isNum(ev.editedAt)) throw new TypeError('bad edit');
  } else if (ev.type === 'delete') {
    if (!isStr(ev.id) || !ev.id) throw new TypeError('bad delete');
  } else {
    throw new TypeError('unknown event type');
  }
}

export function createFeed(options: { me?: string } = {}): Feed {
  const byId = new Map<string, Message>();
  const deleted = new Set<string>();
  const unread = new Set<string>();
  const listeners = new Set<() => void>();
  const notify = () => [...listeners].forEach((l) => l());

  return {
    apply(event) {
      validate(event);
      if (event.type === 'message') {
        const m = event.message;
        if (byId.has(m.id) || deleted.has(m.id)) return;
        byId.set(m.id, { id: m.id, author: m.author, text: m.text, sentAt: m.sentAt, ...(m.editedAt !== undefined ? { editedAt: m.editedAt } : {}) });
        if (m.author !== options.me) unread.add(m.id);
      } else if (event.type === 'edit') {
        const cur = byId.get(event.id);
        if (!cur || (cur.editedAt !== undefined && event.editedAt <= cur.editedAt)) return;
        cur.text = event.text;
        cur.editedAt = event.editedAt;
      } else {
        const existed = byId.delete(event.id);
        deleted.add(event.id);
        unread.delete(event.id);
        if (!existed) return;
      }
      notify();
    },
    messages() {
      return [...byId.values()]
        .sort((a, b) => a.sentAt - b.sentAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((m) => ({ ...m }));
    },
    unreadCount: () => unread.size,
    markRead() {
      if (!unread.size) return;
      unread.clear();
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
