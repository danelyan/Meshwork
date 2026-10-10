'use client';

import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Режим звонка в сцене /consultant (ADR 0003, ступень 1): кнопка «Созвониться» в композере или
 * предложение агента открывают созвон в панели сцены, лента чата на это время сворачивается.
 * Вне провайдера (страницы без сцены, работодатель) хук возвращает null — кнопок звонка нет.
 */
export interface CallMode {
  open: boolean;
  /** Почему агент предложил созвон (suggest_call) — подпись на экране согласия/старта. */
  reason: string | null;
  start: (reason?: string) => void;
  close: () => void;
}

const Ctx = createContext<CallMode | null>(null);

export function useCallMode(): CallMode | null {
  return useContext(Ctx);
}

export function CallProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const start = useCallback((r?: string) => {
    setReason(r ?? null);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, reason, start, close }), [open, reason, start, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
