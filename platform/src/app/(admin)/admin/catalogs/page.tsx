import { CatalogsManager } from '@/components/admin/CatalogsManager';
import { listClaims, listSubcategories, listTemplates } from '@/server/admin/catalogs';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';

/** Справочники (фаза 4): подкатегории, каталог утверждений, публикация шаблонов заданий и проектов. */
export default async function AdminCatalogsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePageStaff('/admin/catalogs', 'edit_catalogs');
  const { q } = await searchParams;
  const [subcategories, claims, templates] = await Promise.all([listSubcategories(), listClaims({ q }), listTemplates()]);
  return (
    <>
      <h1 className={styles.title}>Справочники</h1>
      <p className={styles.muted}>
        Правка идёт с причиной и пишется в журнал. Идентификаторы, веса и грейды утверждений не меняются: на них ссылаются профили кандидатов. Снятый шаблон не выдаётся в новых заданиях; идущие попытки
        и уже созданные задания не затрагиваются.
      </p>
      <CatalogsManager subcategories={subcategories} claims={claims} templates={templates} q={q ?? ''} />
    </>
  );
}
