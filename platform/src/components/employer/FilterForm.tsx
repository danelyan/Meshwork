import { SPEC_LABEL, SPECIALIZATIONS, specLabel, subcategoriesFor, subcategoryLabel } from '@/lib/directions';
import type { MatchFilters } from '@/server/employer/ranking';

import { Button, Field, Panel } from '../ui';
import ui from '../ui.module.css';

import styles from './Employer.module.css';
import { GRADE_LABEL, GRADES } from '@/lib/grades';

export interface FilterFormProps {
  action: string;
  filters: MatchFilters;
}

/**
 * Фильтры выдачи (R-E-04, R-M-04): обычная GET-форма. Каждое уточнение — новый URL,
 * прежняя выдача остаётся в истории браузера и в «Прежних выдачах». Работает без JS.
 */
export function FilterForm({ action, filters }: FilterFormProps) {
  return (
    <Panel>
      <form method="get" action={action} className={styles.filters} aria-label="Фильтры подборки">
      <Field label="Направление">
        <select name="spec" className={ui.input} defaultValue={filters.specialization ?? ''}>
          <option value="">любое</option>
          {SPECIALIZATIONS.map((s) => (
            <option key={s} value={s}>
              {SPEC_LABEL[s]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Подкатегория" hint="Задаёт и направление">
        <select name="sub" className={ui.input} defaultValue={filters.subcategory ?? ''}>
          <option value="">любая</option>
          {SPECIALIZATIONS.map((s) => (
            <optgroup key={s} label={SPEC_LABEL[s]}>
              {subcategoriesFor(s).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="Грейд (категория из теста)">
        <select name="grade" className={ui.input} defaultValue={filters.grade ?? ''}>
          <option value="">любой</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {GRADE_LABEL[g]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Стек" hint="Через запятую">
        <input name="stack" className={ui.input} defaultValue={filters.stack?.join(', ') ?? ''} />
      </Field>
      <div className={styles.actions}>
        <Button type="submit" variant="primary">
          Уточнить
        </Button>
        <Button href={action}>Сбросить</Button>
      </div>
      <div className={styles.checks}>
        <label>
          <input type="checkbox" name="fsp" value="1" defaultChecked={filters.fsp} /> есть достижения ФСП
        </label>
        <label>
          <input type="checkbox" name="category" value="1" defaultChecked={filters.categoryOnly} /> только с категорией из теста
        </label>
      </div>
      </form>
    </Panel>
  );
}

/** Подпись фильтров для «Прежних выдач». */
export function filtersLabel(f: MatchFilters): string {
  const parts: string[] = [];
  if (f.specialization) parts.push(specLabel(f.specialization));
  if (f.subcategory) parts.push(subcategoryLabel(f.subcategory));
  if (f.grade) parts.push(GRADE_LABEL[f.grade]);
  if (f.stack?.length) parts.push(f.stack.join(', '));
  if (f.fsp) parts.push('ФСП');
  if (f.categoryOnly) parts.push('с категорией');
  return parts.length ? parts.join(' · ') : 'без фильтров';
}
