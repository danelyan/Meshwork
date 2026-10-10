'use client';

import { useEffect, useRef } from 'react';

/**
 * Мост «колонка → лента»: карточка «Файлы и ссылки» передаёт загруженные файлы и ссылки
 * консультанту, а тот разбирает их тем же конвейером, что вложения из композера
 * (POST /api/consultant/messages: uploadIds/urls → черновики утверждений в ленте).
 * Событие окна синхронное: обработчик ленты сразу ставит outcome.
 */
export const MATERIALS_EVENT = 'consultant:materials';

export interface Materials {
  uploadIds: string[];
  urls: string[];
  /** Имена файлов — подписи вложений в реплике пользователя. */
  names: string[];
}

/** sent — ход начат; busy — консультант ещё отвечает; none — ленты консультанта на экране нет. */
export type MaterialsOutcome = 'sent' | 'busy' | 'none';

type Detail = Materials & { outcome: MaterialsOutcome };

export function offerMaterials(m: Materials): MaterialsOutcome {
  if (typeof window === 'undefined') return 'none';
  const detail: Detail = { ...m, outcome: 'none' };
  window.dispatchEvent(new CustomEvent<Detail>(MATERIALS_EVENT, { detail }));
  return detail.outcome;
}

/** Лента консультанта принимает материалы из колонки. */
export function useMaterialsHandler(handler: (m: Materials) => Exclude<MaterialsOutcome, 'none'>): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Detail>).detail;
      if (!d || d.outcome !== 'none') return;
      d.outcome = ref.current({ uploadIds: d.uploadIds, urls: d.urls, names: d.names });
    };
    window.addEventListener(MATERIALS_EVENT, on);
    return () => window.removeEventListener(MATERIALS_EVENT, on);
  }, []);
}

/** Текст реплики пользователя, которой материалы уходят в ленту. */
export function materialsMessage(m: Materials): string {
  if (m.urls.length) return `Разбери ${m.urls.length > 1 ? 'ссылки' : 'ссылку'}: ${m.urls.join(' ')}`;
  return m.uploadIds.length > 1 ? 'Разбери загруженные файлы.' : 'Разбери загруженный файл.';
}
