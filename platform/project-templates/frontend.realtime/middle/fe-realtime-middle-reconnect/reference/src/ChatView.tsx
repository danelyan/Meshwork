import { useEffect, useRef, useState, type FormEvent } from 'react';

import type { ConnectionStatus, RealtimeClient } from './client';

export interface ChatViewProps {
  client: RealtimeClient;
  send: (clientId: string, text: string) => Promise<void>;
  makeId?: () => string;
}

interface Item {
  key: string;
  text: string;
  state: 'sent' | 'pending';
}

const LABEL: Record<ConnectionStatus, string> = {
  open: 'Подключено',
  connecting: 'Подключение…',
  reconnecting: 'Переподключение…',
  closed: 'Отключено',
};

let counter = 0;
const defaultId = () => `c${Date.now().toString(36)}-${++counter}`;

export function ChatView({ client, send, makeId = defaultId }: ChatViewProps) {
  const [status, setStatus] = useState<ConnectionStatus>(() => client.status());
  const [items, setItems] = useState<Item[]>([]);
  const [text, setText] = useState('');
  const [failed, setFailed] = useState(false);
  const pending = useRef(new Set<string>());
  const seq = useRef(0);

  useEffect(() => {
    setStatus(client.status());
    const offStatus = client.onStatus(setStatus);
    const offEvent = client.onEvent((e) => {
      if (e.type !== 'message') return;
      const d = e.data as { text?: unknown; clientId?: unknown } | null;
      if (typeof d !== 'object' || d === null || typeof d.text !== 'string') return;
      const text = d.text;
      const cid = typeof d.clientId === 'string' ? d.clientId : undefined;
      const mine = cid !== undefined && pending.current.delete(cid);
      setItems((prev) => [
        ...(mine ? prev.filter((i) => i.key !== `p:${cid}`) : prev),
        { key: `s:${e.id}`, text, state: 'sent' },
      ]);
    });
    return () => {
      offStatus();
      offEvent();
    };
  }, [client]);

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const value = text.trim();
    if (!value || status !== 'open') return;
    const cid = makeId();
    seq.current += 1;
    pending.current.add(cid);
    setFailed(false);
    setText('');
    setItems((prev) => [...prev, { key: `p:${cid}`, text: value, state: 'pending' }]);
    send(cid, value).catch(() => {
      if (!pending.current.delete(cid)) return;
      setItems((prev) => prev.filter((i) => i.key !== `p:${cid}`));
      setFailed(true);
      setText((cur) => (cur === '' ? value : cur));
    });
  }

  return (
    <div>
      <p role="status">{LABEL[status]}</p>
      <ul>
        {items.map((i) => (
          <li key={i.key} data-state={i.state}>
            {i.text}
          </li>
        ))}
      </ul>
      {failed && <p role="alert">Не удалось отправить</p>}
      <form onSubmit={submit}>
        <input aria-label="Сообщение" value={text} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={status !== 'open'}>
          Отправить
        </button>
      </form>
    </div>
  );
}
