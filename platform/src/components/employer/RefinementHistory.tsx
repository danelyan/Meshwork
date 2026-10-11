'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import styles from './Employer.module.css';

const MAX = 6;

export interface RefinementHistoryProps {
  /** Путь выдачи без query (/employer/needs/:id или /employer/search). */
  basePath: string;
  /** Текущая query-строка фильтров ('' – без фильтров). */
  query: string;
  /** Подпись текущих фильтров. */
  label: string;
}

function read(key: string): { query: string; label: string }[] {
  try {
    const raw = sessionStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? (v as { query: string; label: string }[]).filter((x) => typeof x?.query === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Прежние выдачи (R-M-04): каждое уточнение – свой URL, ранжирование детерминировано,
 * поэтому ссылка восстанавливает выдачу. Список – в sessionStorage вкладки.
 */
export function RefinementHistory({ basePath, query, label }: RefinementHistoryProps) {
  const key = `employer-history:${basePath}`;
  const [items, setItems] = useState<{ query: string; label: string }[]>([]);
  useEffect(() => {
    const prev = read(key).filter((x) => x.query !== query);
    const next = [{ query, label }, ...prev].slice(0, MAX);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* приватный режим – история только в браузере «назад» */
    }
    setItems(prev.slice(0, MAX - 1));
  }, [key, query, label]);
  if (items.length === 0) return null;
  return (
    <nav className={styles.history} aria-label="Прежние выдачи">
      <span>Прежние выдачи:</span>
      {items.map((x) => (
        <Link key={x.query || 'base'} href={x.query ? `${basePath}?${x.query}` : basePath}>
          {x.label}
        </Link>
      ))}
    </nav>
  );
}
