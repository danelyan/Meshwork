import { Button } from '@/components/ui';

import styles from '@/app/(admin)/admin/admin.module.css';

/** Постраничная навигация списков: сохраняет фильтры из `params`, меняет только `page`. */
export function Pager({ basePath, params, page, pages, total }: { basePath: string; params: Record<string, string | undefined>; page: number; pages: number; total: number }) {
  const href = (p: number) => {
    const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    if (p > 1) qs.set('page', String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  return (
    <div className={styles.row}>
      <span className={styles.muted}>
        Всего: {total}. Страница {page} из {pages}.
      </span>
      {page > 1 && (
        <Button href={href(page - 1)} variant="ghost" size="sm">
          Назад
        </Button>
      )}
      {page < pages && (
        <Button href={href(page + 1)} variant="ghost" size="sm">
          Дальше
        </Button>
      )}
    </div>
  );
}
