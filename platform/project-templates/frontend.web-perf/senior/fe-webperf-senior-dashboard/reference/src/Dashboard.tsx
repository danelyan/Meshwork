import { memo, Profiler, useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import type { QueryCache } from './queryCache';

export interface WidgetSpec {
  id: string;
  title: string;
  key: string;
}
export interface DashboardProps {
  cache: QueryCache;
  widgets: WidgetSpec[];
  onWidgetRender?: (id: string) => void;
}

interface WidgetProps {
  cache: QueryCache;
  id: string;
  title: string;
  queryKey: string;
  onWidgetRender?: (id: string) => void;
}

const noop = () => {};

const Widget = memo(function Widget({ cache, id, title, queryKey, onWidgetRender }: WidgetProps) {
  const subscribe = useCallback((cb: () => void) => cache.subscribe(queryKey, cb), [cache, queryKey]);
  const snap = useSyncExternalStore(subscribe, () => cache.peek(queryKey));

  useEffect(() => {
    cache.fetch(queryKey).catch(noop);
  }, [cache, queryKey]);

  let body;
  if (snap.status === 'error') {
    body = (
      <div role="alert">
        Не удалось загрузить: {title}{' '}
        <button type="button" onClick={() => cache.fetch(queryKey, { force: true }).catch(noop)}>
          Повторить
        </button>
      </div>
    );
  } else if (snap.data !== undefined) {
    body = <p data-testid="value">{String((snap.data as { value: number }).value)}</p>;
  } else {
    body = <p role="status">Загрузка…</p>;
  }

  return (
    <Profiler id={id} onRender={() => onWidgetRender?.(id)}>
      <section aria-label={title}>
        <h2>{title}</h2>
        {body}
      </section>
    </Profiler>
  );
});

export function Dashboard({ cache, widgets, onWidgetRender }: DashboardProps) {
  const [compact, setCompact] = useState(false);
  const refresh = () => {
    for (const key of new Set(widgets.map((w) => w.key))) {
      cache.invalidate(key);
      cache.fetch(key).catch(noop);
    }
  };
  return (
    <div data-compact={String(compact)}>
      <button type="button" aria-pressed={compact} onClick={() => setCompact((c) => !c)}>
        Компактный вид
      </button>
      <button type="button" onClick={refresh}>
        Обновить всё
      </button>
      {widgets.map((w) => (
        <Widget key={w.id} cache={cache} id={w.id} title={w.title} queryKey={w.key} onWidgetRender={onWidgetRender} />
      ))}
    </div>
  );
}
