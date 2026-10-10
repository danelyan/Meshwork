// Эталон: дребезг, отмена и номер запроса против гонок, LRU-кэш, combobox по WAI-ARIA.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';

export interface Item {
  id: string;
  title: string;
}

export interface SearchBoxProps {
  search: (query: string, signal: AbortSignal) => Promise<Item[]>;
  onSelect: (item: Item) => void;
  debounceMs?: number;
  label?: string;
}

type View = { kind: 'idle' } | { kind: 'loading' } | { kind: 'done'; items: Item[] } | { kind: 'error' };

const CACHE_SIZE = 20;

export function SearchBox({ search, onSelect, debounceMs = 250, label = 'Поиск' }: SearchBoxProps) {
  const [value, setValue] = useState('');
  const [view, setView] = useState<View>({ kind: 'idle' });
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const cache = useRef(new Map<string, Item[]>());
  const ctrl = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
  const listId = useId();
  const query = value.trim();

  const invalidate = () => {
    ctrl.current?.abort();
    ctrl.current = null;
    return ++seq.current;
  };

  const show = (items: Item[]) => {
    setView({ kind: 'done', items });
    setActive(-1);
    setOpen(true);
  };

  const run = useCallback((q: string) => {
    const my = invalidate();
    const c = new AbortController();
    ctrl.current = c;
    setView({ kind: 'loading' });
    setActive(-1);
    setOpen(true);
    searchRef.current(q, c.signal).then(
      (items) => {
        if (my !== seq.current) return;
        cache.current.delete(q);
        cache.current.set(q, items);
        if (cache.current.size > CACHE_SIZE) cache.current.delete(cache.current.keys().next().value as string);
        show(items);
      },
      () => {
        if (my !== seq.current) return;
        setView({ kind: 'error' });
      },
    );
  }, []);

  useEffect(() => {
    invalidate();
    if (!query) {
      setView({ kind: 'idle' });
      return;
    }
    const timer = setTimeout(() => {
      const hit = cache.current.get(query);
      if (hit) {
        cache.current.delete(query);
        cache.current.set(query, hit);
        invalidate();
        show(hit);
        return;
      }
      run(query);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs, run]);

  const items = view.kind === 'done' ? view.items : [];
  const expanded = open && items.length > 0;
  const optId = (i: number) => `${listId}-opt-${i}`;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!expanded) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      onSelect(items[active]!);
    }
  };

  return (
    <div>
      <input
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={expanded}
        aria-activedescendant={expanded && active >= 0 ? optId(active) : undefined}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {view.kind === 'loading' && <div role="status">Загрузка…</div>}
      {view.kind === 'done' && items.length === 0 && <div role="status">Ничего не найдено</div>}
      {view.kind === 'error' && (
        <div role="alert">
          Не удалось загрузить{' '}
          <button type="button" onClick={() => run(query)}>
            Повторить
          </button>
        </div>
      )}
      <ul role="listbox" id={listId} hidden={!expanded}>
        {items.map((it, i) => (
          <li key={it.id} id={optId(i)} role="option" aria-selected={i === active} onClick={() => onSelect(it)}>
            {it.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
