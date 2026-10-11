'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button, Notice, Popover } from '@/components/ui';
import { readError } from '@/lib/api';
import type { NotificationFeed } from '@/server/auth/notifications';
import styles from './Notifications.module.css';

export function Notifications({ role }: { role: string }) {
  const [open, setOpen] = useState(false);
  const [feed, setFeed] = useState<NotificationFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setFeed(null); setError(null);
    fetch('/api/notifications', { signal: abort.signal }).then(async (r) => {
      if (!r.ok) throw await readError(r);
      return r.json() as Promise<NotificationFeed>;
    }).then(setFeed).catch((e: Error) => { if (e.name !== 'AbortError') setError(e.message); });
    const close = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => { abort.abort(); document.removeEventListener('pointerdown', close); };
  }, [open, role]);
  async function readAll() {
    if (!feed || busy) return;
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ through: feed.through }) });
      if (!r.ok) throw await readError(r);
      setFeed(await r.json() as NotificationFeed);
    } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось отметить прочтение'); }
    finally { setBusy(false); }
  }
  return <div className={styles.root} ref={root} onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus(); } }}>
    <button className={styles.trigger} ref={trigger} aria-label="Уведомления" aria-expanded={open} onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M6 9a6 6 0 0 1 12 0v6l2 3H4l2-3Z M10 21h4" /></svg>
      {feed && feed.unread > 0 && <b>{feed.unread}</b>}
    </button>
    <Popover open={open} className={styles.panel} role="region" aria-label="Последние уведомления" style={{ transformOrigin: 'top right' }}>
      <header><h2>Уведомления</h2><Button size="sm" variant="ghost" disabled={!feed?.unread} loading={busy} onClick={() => void readAll()}>Прочитать все</Button></header>
      {error && <Notice tone="error">{error}</Notice>}
      {!feed && !error && <p role="status">Загружаем…</p>}
      {feed?.items.length === 0 && <p>Новых событий пока нет.</p>}
      {feed?.items.map((item) => <Link className={styles.item} href={item.href} key={item.id} data-unread={item.unread} onClick={() => setOpen(false)}><strong>{item.text}</strong><span>{item.detail}</span><time dateTime={item.at}>{new Date(item.at).toLocaleDateString('ru-RU')}</time></Link>)}
    </Popover>
  </div>;
}
