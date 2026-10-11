'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const FLUSH_MS = 10_000;

interface Deltas {
  tabHidden: number;
  hiddenMs: number;
  pastes: number;
  pasteChars: number;
  copies: number;
}

/** Живые счётчики по текущему заданию - для слоя жюри (JURY_INSIGHTS); на экран кандидата не попадают. */
export interface SignalTotals {
  tabHidden: number;
  hiddenMs: number;
  pastes: number;
  copies: number;
  extendedScreen: boolean | null;
}

const emptyTotals = (): SignalTotals => ({ tabHidden: 0, hiddenMs: 0, pastes: 0, copies: 0, extendedScreen: null });

const empty = (): Deltas => ({ tabHidden: 0, hiddenMs: 0, pastes: 0, pasteChars: 0, copies: 0 });

function send(url: string, body: string): void {
  try {
    // text/plain без Blob: sendBeacon не требует CORS-предпроверки, сервер разбирает тело как JSON.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, body)) return;
  } catch {
    /* падаем на fetch */
  }
  try {
    void fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain' }, body, keepalive: true, credentials: 'same-origin' }).catch(() => undefined);
  } catch {
    /* сигналы не критичны */
  }
}

/**
 * Сигналы честности (ADR-0002): уход со вкладки, вставка в поле ответа, копирование условия, второй экран.
 * Копит дельты и шлёт раз в 10 с, при смене задания, при скрытии вкладки и при размонтировании.
 * Ничего не блокирует: preventDefault не вызывается; ответы сервера (в т.ч. 409) игнорируются.
 * Возвращает обработчики для поля ответа (onPaste) и блока условия (onCopy).
 */
/** `base` — префикс API попыток: кандидат `/api/test`, режим эксперта `/api/expert`. */
export function useIntegritySignals(attemptId: string, itemIndex: number, enabled = true, base = '/api/test') {
  const acc = useRef<Deltas>(empty());
  const hiddenSince = useRef<number | null>(null);
  const extendedSent = useRef(false);
  const [totals, setTotals] = useState<SignalTotals>(emptyTotals);
  const bump = useCallback((patch: (t: SignalTotals) => Partial<SignalTotals>) => setTotals((t) => ({ ...t, ...patch(t) })), []);

  const flush = useCallback(() => {
    if (!enabled) return;
    const d = acc.current;
    if (hiddenSince.current !== null) {
      const now = Date.now();
      d.hiddenMs += Math.max(0, now - hiddenSince.current);
      hiddenSince.current = now;
    }
    const screenObj = typeof screen !== 'undefined' ? (screen as Screen & { isExtended?: boolean }) : undefined;
    const ext = !extendedSent.current && screenObj && typeof screenObj.isExtended === 'boolean' ? screenObj.isExtended : undefined;
    const empt = !d.tabHidden && !d.hiddenMs && !d.pastes && !d.pasteChars && !d.copies;
    if (empt && ext === undefined) return;
    const body: Record<string, number | boolean> = { ...d };
    if (ext !== undefined) {
      body.extendedScreen = ext;
      bump(() => ({ extendedScreen: ext }));
      extendedSent.current = true;
    }
    acc.current = empty();
    send(`${base}/attempt/${encodeURIComponent(attemptId)}/signal`, JSON.stringify(body));
  }, [attemptId, enabled, bump, base]);

  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        acc.current.tabHidden += 1;
        bump((t) => ({ tabHidden: t.tabHidden + 1 }));
        hiddenSince.current = Date.now();
        flush();
      } else if (hiddenSince.current !== null) {
        const away = Math.max(0, Date.now() - hiddenSince.current);
        acc.current.hiddenMs += away;
        bump((t) => ({ hiddenMs: t.hiddenMs + away }));
        hiddenSince.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const timer = setInterval(flush, FLUSH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(timer);
      flush();
    };
    // itemIndex в зависимостях: смена задания = cleanup с отправкой накопленного.
  }, [flush, enabled, itemIndex, bump]);

  // Счётчики слоя жюри - по заданию: со сменой задания обнуляются.
  useEffect(() => setTotals((t) => ({ ...emptyTotals(), extendedScreen: t.extendedScreen })), [itemIndex]);

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    acc.current.pastes += 1;
    acc.current.pasteChars += e.clipboardData?.getData('text')?.length ?? 0;
    bump((t) => ({ pastes: t.pastes + 1 }));
  }, [bump]);
  const onCopy = useCallback(() => {
    acc.current.copies += 1;
    bump((t) => ({ copies: t.copies + 1 }));
  }, [bump]);

  return { onPaste, onCopy, totals };
}
