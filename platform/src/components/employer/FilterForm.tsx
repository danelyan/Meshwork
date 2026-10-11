import { SPEC_LABEL, SPECIALIZATIONS, specLabel, subcategoriesFor, subcategoryLabel } from '@/lib/directions';
import type { MatchFilters } from '@/server/employer/ranking';
import { Button } from '../ui';
import ui from '../ui.module.css';
import styles from './Employer.module.css';
import { GRADE_LABEL, GRADES } from '@/lib/grades';

export interface FilterFormProps { action: string; filters: MatchFilters; }
/**
 * Native GET controls keep filtered results bookmarkable and work without JavaScript. Выдача по умолчанию — только
 * кандидаты с категорией из теста (M05); «Расширить» (pool=all) добавляет кандидатов без категории с пометкой.
 */
export function FilterForm({ action, filters }: FilterFormProps) {
  return <form method="get" action={action} className={styles.searchFilters} aria-label="Фильтры подборки">
    <div className={styles.filterLine}><span>Специализация</span><label><input type="radio" name="spec" value="" defaultChecked={!filters.specialization && !filters.fullstack} /><span>Все</span></label>{SPECIALIZATIONS.map((specialization) => <label key={specialization}><input type="radio" name="spec" value={specialization} defaultChecked={filters.specialization === specialization} /><span>{SPEC_LABEL[specialization]}</span></label>)}<label><input type="radio" name="spec" value="fullstack" defaultChecked={filters.fullstack} /><span>Fullstack</span></label></div>
    <div className={styles.filterLine}><span>Грейд</span><label><input type="radio" name="grade" value="" defaultChecked={!filters.grade} /><span>Все</span></label>{GRADES.map((grade) => <label key={grade}><input type="radio" name="grade" value={grade} defaultChecked={filters.grade === grade} /><span>{GRADE_LABEL[grade]}</span></label>)}</div>
    <div className={styles.filterLine}><span>Стек</span><input name="stack" aria-label="Стек через запятую" placeholder="Например, React, SQL" className={ui.input} style={{ maxWidth: 360 }} defaultValue={filters.stack?.join(', ') ?? ''} /></div>
    <div className={styles.filterLine}><span>Подтверждено</span><label><input type="checkbox" name="fsp" value="1" defaultChecked={filters.fsp} /><span>Достижения ФСП</span></label></div>
    <div className={styles.filterLine}><span>Пул</span><label><input type="checkbox" name="pool" value="all" defaultChecked={filters.expandPool} /><span>Расширить: кандидаты без категории из теста</span></label></div>
    <div className={styles.filterLine}><span>Подкатегория</span><select name="sub" aria-label="Подкатегория" className={ui.input} style={{ maxWidth: 360 }} defaultValue={filters.subcategory ?? ''}><option value="">Любая</option>{SPECIALIZATIONS.map((specialization) => <optgroup key={specialization} label={SPEC_LABEL[specialization]}>{subcategoriesFor(specialization).map((subcategory) => <option key={subcategory.id} value={subcategory.id}>{subcategory.title}</option>)}</optgroup>)}</select></div>
    <div className={styles.filterLine}><Button type="submit" variant="primary" size="sm">Уточнить</Button><Button href={action} size="sm">Сбросить</Button></div>
  </form>;
}
export function filtersLabel(f: MatchFilters): string {
  const parts: string[] = [];
  if (f.fullstack) parts.push('Fullstack');
  if (f.specialization) parts.push(specLabel(f.specialization));
  if (f.subcategory) parts.push(subcategoryLabel(f.subcategory));
  if (f.grade) parts.push(GRADE_LABEL[f.grade]);
  if (f.stack?.length) parts.push(f.stack.join(', '));
  if (f.fsp) parts.push('ФСП');
  if (f.expandPool) parts.push('расширенный пул');
  return parts.length ? parts.join(' · ') : 'без фильтров';
}
