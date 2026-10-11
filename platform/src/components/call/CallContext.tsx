'use client';

import type { CallKind } from '@/server/call/types';

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { callApi } from '@/lib/call-api';

/**
 * Режим звонка в сцене /consultant (ADR 0003, ступень 1): кнопка «Созвониться» в композере или
 * предложение агента открывают созвон в панели сцены, лента чата на это время сворачивается.
 * Вне провайдера (страницы без сцены, работодатель) хук возвращает null — кнопок звонка нет.
 */
export interface CallMode {
  /** Вид режима: до теста на грейд — квалифицирующий созвон, после — ИИнтервью (решается на сервере). */
  kind: CallKind;
  open: boolean;
  /** Можно ли начать созвон (GET /api/call → readiness); null — ещё не знаем (кнопка не блокируется). */
  readiness: { ready: boolean; reason?: string; retryAt?: string } | null;
  /** Почему агент предложил созвон (suggest_call) — подпись на экране согласия/старта. */
  reason: string | null;
  start: (reason?: string) => void;
  close: () => void;
}

const Ctx = createContext<CallMode | null>(null);

export function useCallMode(): CallMode | null {
  return useContext(Ctx);
}

export function CallProvider({ children, kind = 'qualifying', initialOpen = false }: { children: ReactNode; kind?: CallKind; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const [reason, setReason] = useState<string | null>(null);
  const start = useCallback((r?: string) => {
    setReason(r ?? null);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const [readiness, setReadiness] = useState<CallMode['readiness']>(null);
  // Опрос читает готовность через ref: смена ready не перезапускает эффект (раньше null → false давала лишний GET сразу).
  const readyRef = useRef<boolean | undefined>(undefined);
  readyRef.current = readiness?.ready;
  // Готовность читаем с сервера: при монтировании, после закрытия панели и пока кнопка заблокирована (в чате
  // могли появиться утверждения о навыках). Сбой запроса кнопку не блокирует: старт всё равно проверит сервер.
  useEffect(() => {
    if (open) return;
    let alive = true;
    const load = () =>
      callApi
        .list(kind)
        .then((r) => alive && setReadiness((kind === 'defense' ? null : r.readiness?.[kind]) ?? null))
        .catch(() => undefined);
    void load();
    const t = setInterval(() => {
      if (readyRef.current === false && !document.hidden) void load();
    }, 20000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [kind, open]);
  const value = useMemo(() => ({ kind, open, readiness, reason, start, close }), [kind, open, readiness, reason, start, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
