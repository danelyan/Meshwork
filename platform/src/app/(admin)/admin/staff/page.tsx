import { StaffManager } from '@/components/admin/StaffManager';
import { requirePageStaff } from '@/server/admin/session';
import { listStaff } from '@/server/admin/staff';

import styles from '../admin.module.css';

/** Персонал платформы (только owner): пригласить, сменить роль, отключить, сбросить 2FA. */
export default async function AdminStaffPage() {
  const me = await requirePageStaff('/admin/staff', 'manage_staff');
  const staff = await listStaff();
  return (
    <>
      <h1 className={styles.title}>Персонал</h1>
      <p className={styles.muted}>Любое изменение отзывает сессии сотрудника и пишется в журнал с причиной. Свою учётку меняет другой владелец.</p>
      <StaffManager meId={me.staffId} initial={staff.map((s) => ({ ...s, totpEnabledAt: s.totpEnabledAt?.toISOString() ?? null, disabledAt: s.disabledAt?.toISOString() ?? null, createdAt: s.createdAt.toISOString() }))} />
    </>
  );
}
