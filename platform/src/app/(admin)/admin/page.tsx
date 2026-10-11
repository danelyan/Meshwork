import { Notice } from '@/components/ui';
import { STAFF_ROLE_LABEL } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from './admin.module.css';

/** Обзор админки. Дашборд (фаза 1 E-08) делает лейн фазы 1 в этом файле. */
export default async function AdminHomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const staff = await requirePageStaff('/admin', 'view_dashboard');
  const { denied } = await searchParams;
  return (
    <>
      <h1 className={styles.title}>Обзор</h1>
      {denied && <Notice tone="error">Раздел недоступен для роли «{STAFF_ROLE_LABEL[staff.role]}».</Notice>}
      <p className={styles.muted}>
        {staff.name}, вы вошли как «{STAFF_ROLE_LABEL[staff.role]}». Разделы слева открыты по правам роли; каждое действие пишется в журнал.
      </p>
    </>
  );
}
