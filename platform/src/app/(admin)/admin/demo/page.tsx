import { DemoManager, type DemoData } from '@/components/admin/DemoManager';
import { listDemo } from '@/server/admin/accounts/service';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';

export const dynamic = 'force-dynamic';

/** Демо-данные (только owner): демо-аккаунты и компании, чистка мусора e2e, показ демо в подборке. */
export default async function AdminDemoPage() {
  await requirePageStaff('/admin/demo', 'manage_demo');
  const d = await listDemo();
  const data: DemoData = { ...d, users: d.users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })) };
  return (
    <>
      <h1 className={styles.title}>Демо-данные</h1>
      <p className={styles.muted}>Удаляется только мусор e2e по явным маркерам и только то, что показано на экране. Каждое действие — в журнале с причиной.</p>
      <DemoManager initial={data} />
    </>
  );
}
