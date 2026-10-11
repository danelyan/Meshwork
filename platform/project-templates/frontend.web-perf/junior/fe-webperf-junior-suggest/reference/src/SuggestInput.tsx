import { useEffect, useRef, useState } from 'react';

export interface SuggestInputProps {
  debounceMs?: number;
  minLength?: number;
}

export function SuggestInput({ debounceMs = 300, minLength = 2 }: SuggestInputProps) {
  const [value, setValue] = useState('');
  const [items, setItems] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const lastQuery = useRef<string | null>(null);

  useEffect(() => {
    const query = value.trim();
    if (query.length < minLength) {
      controller.current?.abort();
      controller.current = null;
      lastQuery.current = null;
      setItems(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    if (query === lastQuery.current) return;
    const timer = setTimeout(() => {
      controller.current?.abort();
      const own = new AbortController();
      controller.current = own;
      lastQuery.current = query;
      setLoading(true);
      setFailed(false);
      fetch('/api/suggest?q=' + encodeURIComponent(query), { signal: own.signal })
        .then((res) => {
          if (!res.ok) throw new Error('http');
          return res.json() as Promise<{ items: string[] }>;
        })
        .then((body) => {
          if (own.signal.aborted || controller.current !== own) return;
          setItems(body.items);
          setLoading(false);
        })
        .catch(() => {
          if (own.signal.aborted || controller.current !== own) return;
          lastQuery.current = null;
          setFailed(true);
          setLoading(false);
        });
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [value, debounceMs, minLength]);

  useEffect(() => () => controller.current?.abort(), []);

  return (
    <div>
      <input aria-label="Поиск" value={value} onChange={(e) => setValue(e.target.value)} />
      {loading && <p role="status">Загрузка…</p>}
      {failed && <p role="alert">Не удалось загрузить</p>}
      {!loading && !failed && items && items.length === 0 && <p role="status">Ничего не найдено</p>}
      {items && items.length > 0 && (
        <ul aria-label="Подсказки">
          {items.map((t, i) => (
            <li key={`${t}-${i}`}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
