import React, { useRef, useState } from 'react';

// Эталонное решение шаблона fe-uiapp-junior-widget (фикстура тестов runner).
export default function FilterList({ items, placeholder = 'Поиск' }) {
  const [query, setQuery] = useState('');
  const input = useRef(null);
  const q = query.trim().toLowerCase();
  const found = q ? items.filter((i) => i.toLowerCase().includes(q)) : items;
  return (
    <div>
      <input type="search" aria-label="Фильтр" placeholder={placeholder} value={query} ref={input} onChange={(e) => setQuery(e.target.value)} />
      <button type="button" disabled={query === ''} onClick={() => { setQuery(''); input.current?.focus(); }}>
        Очистить
      </button>
      <p role="status">Найдено: {found.length}</p>
      {found.length ? (
        <ul>
          {found.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      ) : (
        <p>Ничего не найдено</p>
      )}
    </div>
  );
}
