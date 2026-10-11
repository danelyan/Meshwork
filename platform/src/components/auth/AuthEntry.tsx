'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';
import { safeNext } from '@/server/auth/redirect';
import { AuthEntryFlow } from './AuthEntryFlow';
import styles from './AuthEntry.module.css';

function EntryDialog({ onClose, ...props }: {
  yandexEnabled: boolean; fspHint: string | null; demoEnabled: boolean; next: string | null; error?: string | null; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="auth-entry-title"
    onCancel={event=>{event.preventDefault();onClose();}}>
    <AuthEntryFlow {...props} onClose={onClose} />
  </dialog>;
}

/** Normal /auth links open in place; modified clicks and direct routes keep their fallback. */
export function AuthEntry({ children, yandexEnabled, fspHint = null, demoEnabled, initiallyOpen = false, next = null, error = null }: {
  children: ReactNode; yandexEnabled: boolean; fspHint?: string | null; demoEnabled: boolean; initiallyOpen?: boolean; next?: string | null; error?: string | null;
}) {
  const [entry, setEntry] = useState<{next:string|null} | null>(initiallyOpen ? {next:safeNext(next)} : null);
  return <div onClickCapture={event=>{
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = (event.target as Element).closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || anchor.target || anchor.hasAttribute('download')) return;
    const url = new URL(anchor.href, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname !== '/auth') return;
    event.preventDefault(); event.stopPropagation();
    setEntry({next:safeNext(url.searchParams.get('next'))});
  }}>
    {children}
    {entry && <EntryDialog yandexEnabled={yandexEnabled} fspHint={fspHint} demoEnabled={demoEnabled} next={entry.next} error={error}
      onClose={()=>{ if (initiallyOpen) window.location.assign('/'); else setEntry(null); }} />}
  </div>;
}
