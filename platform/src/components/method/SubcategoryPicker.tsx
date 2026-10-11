'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import type { SimSubcategory } from '@/server/validation/simulator';

import styles from './Method.module.css';

/**
 * Выбор подкатегории без перезагрузки: смена значения – мягкая навигация на тот же адрес с `?sub=`,
 * сервер пересчитывает графики и симуляцию, прокрутка и остальная страница остаются на месте
 * (router.replace со scroll: false; переход – React-транзиция, isPending показывает ожидание).
 */
export function SubcategoryPicker({ subcategories, selected }: { subcategories: SimSubcategory[]; selected: SimSubcategory | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const bySpec = new Map<string, SimSubcategory[]>();
  for (const s of subcategories) bySpec.set(s.specializationTitle, [...(bySpec.get(s.specializationTitle) ?? []), s]);
  return (
    <div className={styles.picker} aria-label="Подкатегория для графиков и симуляции" aria-busy={pending}>
      <label className={styles.pickerField}>
        <span className={styles.pickerLabel}>Направление и подкатегория{pending ? ' · считаю…' : ''}</span>
        <select
          name="sub"
          className={styles.select}
          value={selected?.id ?? ''}
          disabled={pending}
          onChange={(e) => {
            const id = e.currentTarget.value;
            startTransition(() => router.replace(`/method?sub=${encodeURIComponent(id)}`, { scroll: false }));
          }}
        >
          {[...bySpec.entries()].map(([spec, subs]) => (
            <optgroup key={spec} label={spec}>
              {subs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
    </div>
  );
}
