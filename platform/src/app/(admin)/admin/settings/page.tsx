import { SettingsManager } from '@/components/admin/SettingsManager';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';
import { SETTING_GROUPS, listSettings } from '@/server/admin/settings';
import { GRADE_CUT } from '@/server/test/policy';

import styles from '../admin.module.css';

/** Настройки платформы без деплоя (фаза 4): значение, умолчание из кода, кто менял, причина, история и откат. */
export default async function AdminSettingsPage() {
  const staff = await requirePageStaff('/admin/settings', 'view_settings');
  const settings = (await listSettings()).filter((s) => !s.internal);
  return (
    <>
      <h1 className={styles.title}>Настройки платформы</h1>
      <p className={styles.muted}>
        Значение из базы перекрывает умолчание из кода и применяется не позже чем через 30 секунд. Каждое изменение требует причины, сохраняется в истории и пишется в журнал. Секреты и вход в демо
        здесь не настраиваются.
      </p>
      <SettingsManager groups={SETTING_GROUPS.filter((g) => g.id !== 'catalog')} initial={settings} canEdit={can(staff.role, 'edit_settings')} />
      <h2 className={styles.title}>Пороги грейдов (только чтение)</h2>
      <p className={styles.muted}>Шкала θ. Пороги меняются калибровкой (docs/test-calibration.md), а не ручкой: ручной выбор грейда противоречит R-C-06.</p>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Грейд</th>
            <th>Порог θ</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(GRADE_CUT).map(([grade, cut]) => (
            <tr key={grade}>
              <td>{grade}</td>
              <td className={styles.mono}>{cut}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
