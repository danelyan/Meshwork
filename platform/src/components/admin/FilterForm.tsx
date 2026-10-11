import { Button } from '@/components/ui';
import ui from '@/components/ui.module.css';

import styles from '@/app/(admin)/admin/admin.module.css';

export type FilterField =
  | { name: string; label: string; type: 'text'; placeholder?: string }
  | { name: string; label: string; type: 'select'; options: [value: string, label: string][] };

/** GET-форма фильтров списка: сервер читает значения из адреса, поэтому фильтр можно сохранить ссылкой. */
export function FilterForm({ action, fields, values }: { action: string; fields: FilterField[]; values: Record<string, string | undefined> }) {
  return (
    <form className={styles.filters} method="get" action={action}>
      {fields.map((f) =>
        f.type === 'text' ? (
          <input key={f.name} className={ui.input} name={f.name} placeholder={f.placeholder ?? f.label} defaultValue={values[f.name]} aria-label={f.label} />
        ) : (
          <select key={f.name} className={ui.input} name={f.name} defaultValue={values[f.name] ?? ''} aria-label={f.label}>
            <option value="">{f.label}: любой</option>
            {f.options.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        ),
      )}
      <Button type="submit" size="sm">
        Найти
      </Button>
      <Button href={action} variant="ghost" size="sm">
        Сбросить
      </Button>
    </form>
  );
}
