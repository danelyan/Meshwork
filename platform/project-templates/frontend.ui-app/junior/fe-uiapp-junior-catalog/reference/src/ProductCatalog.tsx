// Эталонное решение (кандидату не выдаётся).
import { useMemo, useState } from 'react';

import type { Product } from './types';

const ALL = 'Все';
const rub = (n: number) => `${new Intl.NumberFormat('ru-RU').format(n)} ₽`;

export function ProductCatalog({ products }: { products: Product[] }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [cart, setCart] = useState<Record<string, number>>({});

  const categories = useMemo(() => [...new Set(products.map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'ru')), [products]);
  const q = query.trim().toLowerCase();
  const visible = products.filter((p) => (category === ALL || p.category === category) && (!q || p.name.toLowerCase().includes(q)));
  const count = Object.values(cart).reduce((s, n) => s + n, 0);
  const total = products.reduce((s, p) => s + (cart[p.id] ?? 0) * p.priceRub, 0);

  return (
    <div>
      <label>
        Поиск <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <label>
        Категория{' '}
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value={ALL}>{ALL}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <p>Найдено: {visible.length}</p>
      {visible.length ? (
        <ul aria-label="Товары">
          {visible.map((p) => (
            <li key={p.id}>
              <span>{p.name}</span> <span>{rub(p.priceRub)}</span>{' '}
              <button type="button" disabled={!p.inStock} onClick={() => setCart((c) => ({ ...c, [p.id]: (c[p.id] ?? 0) + 1 }))}>
                {p.inStock ? 'В корзину' : 'Нет в наличии'}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div>
          <p>Ничего не найдено</p>
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setCategory(ALL);
            }}
          >
            Сбросить фильтры
          </button>
        </div>
      )}
      <section aria-label="Корзина">
        <p>Товаров: {count}</p>
        <p>Сумма: {rub(total)}</p>
      </section>
    </div>
  );
}
