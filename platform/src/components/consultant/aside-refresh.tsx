'use client';

import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { SceneAsideData } from '@/server/consultant/aside';

/** Пауза после последнего события ленты: несколько событий подряд дают один запрос. */
export const ASIDE_DEBOUNCE_MS = 500;

interface AsideState {
  data: SceneAsideData | undefined;
  refresh: () => void;
}

const AsideContext = createContext<AsideState>({ data: undefined, refresh: () => undefined });

/**
 * Правая колонка сцены («Твой путь», «Документы», «Подсказка») держит данные здесь. Начальные приходят
 * с сервера страницы; `refresh()` из ленты (конец хода консультанта, подтверждение утверждений, шаг
 * знакомства) через 500 мс перечитывает GET /api/consultant/aside. Ошибка запроса — колонка остаётся
 * прежней. Таймера-опроса нет.
 */
export function AsideProvider({ initial, children }: { initial?: SceneAsideData; children: ReactNode }) {
  const [data, setData] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const enabled = initial !== undefined;
  // Страница перерисовалась на сервере (мягкое обновление: «Скрыть», выбор роли, итог знакомства) — взять её данные.
  useEffect(() => {
    if (initial !== undefined) setData(initial);
  }, [initial]);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      ctrl.current?.abort();
    },
    [],
  );
  const refresh = useCallback(() => {
    if (!enabled) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      try {
        const res = await fetch('/api/consultant/aside', { signal: c.signal, cache: 'no-store' });
        if (!res.ok) return;
        const next = (await res.json()) as SceneAsideData;
        if (!c.signal.aborted) setData(next);
      } catch {
        // колонка остаётся прежней
      }
    }, ASIDE_DEBOUNCE_MS);
  }, [enabled]);
  const value = useMemo(() => ({ data, refresh }), [data, refresh]);
  return <AsideContext.Provider value={value}>{children}</AsideContext.Provider>;
}

/** Данные колонки (или undefined, если сцена без неё). */
export function useAsideData(): SceneAsideData | undefined {
  return useContext(AsideContext).data;
}

/** Перечитать колонку: вызывать после события ленты. Вне сцены — пустая функция. */
export function useAsideRefresh(): () => void {
  return useContext(AsideContext).refresh;
}
