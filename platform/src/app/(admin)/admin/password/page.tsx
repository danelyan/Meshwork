import { AdminPasswordForm } from '@/components/admin/AdminPasswordForm';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';

/** Смена своего пароля (временный пароль из приглашения меняют после первого входа). */
export default async function AdminPasswordPage() {
  await requirePageStaff('/admin/password');
  return (
    <>
      <h1 className={styles.title}>Пароль</h1>
      <AdminPasswordForm />
    </>
  );
}
