import Link from 'next/link';
import { companyDisplayName } from '@/lib/company-brand';

import { UserActions } from '@/components/admin/actions';
import { RevealPii } from '@/components/admin/RevealPii';
import { CONSENT_LABEL, USER_ROLE_LABEL, fmtDateTime } from '@/components/admin/labels';
import { Panel, Tag } from '@/components/ui';
import { isBlockedNow } from '@/server/admin/accounts/state';
import { getUserCard } from '@/server/admin/overview/cards';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../../admin.module.css';
import { orNotFound } from '../../listing';

/** Карточка учётной записи. Имя и почта скрыты до «Показать ПДн» (причина → журнал). */
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageStaff(`/admin/users/${id}`, 'view_users');
  const u = await orNotFound(getUserCard(id));
  return (
    <>
      <h1 className={styles.title}>Учётная запись</h1>
      <Panel className={styles.section}>
        <dl className={styles.kv}>
          <dt>id</dt>
          <dd className={styles.mono}>{u.id}</dd>
          <dt>Роль</dt>
          <dd>{USER_ROLE_LABEL[u.role]}</dd>
          <dt>Имя</dt>
          <dd>{u.name ?? '—'}</dd>
          <dt>Почта</dt>
          <dd className={styles.mono}>{u.email ?? '—'}</dd>
          <dt>Вход через</dt>
          <dd>{u.providers.join(', ') || (u.isDemo ? 'демо' : '—')}</dd>
          <dt>Создана</dt>
          <dd>{fmtDateTime(u.createdAt)}</dd>
          <dt>Онбординг</dt>
          <dd>{u.onboardedAt ? fmtDateTime(u.onboardedAt) : 'не завершён'}</dd>
          <dt>Профиль</dt>
          <dd>
            {u.candidate && <Link href={`/admin/candidates/${u.candidate.id}`}>{u.candidate.pseudonym}</Link>}
            {u.employerProfile && <Link href={`/admin/companies/${u.employerProfile.company.id}`}>{companyDisplayName(u.employerProfile.company.name)}</Link>}
            {!u.candidate && !u.employerProfile && '—'}
          </dd>
          <dt>Блокировка</dt>
          <dd>{isBlockedNow(u) && u.blockedAt ? `с ${fmtDateTime(u.blockedAt)}${u.blockedUntil ? ` до ${fmtDateTime(u.blockedUntil)}` : ' бессрочно'}: ${u.blockedReason ?? ''}` : 'нет'}</dd>
        </dl>
        <RevealPii url={`/api/admin/users/${u.id}/pii`} canReveal={can(staff.role, 'reveal_pii')} />
        {u.isDemo && <Tag>демо</Tag>}
      </Panel>
      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Согласия</h2>
        <table className={styles.table}>
          <tbody>
            {u.consents.map((k) => (
              <tr key={k.id}>
                <td>{CONSENT_LABEL[k.kind] ?? k.kind}</td>
                <td className={styles.mono}>{k.version}</td>
                <td className={styles.mono}>{fmtDateTime(k.acceptedAt)}</td>
                <td>{k.active ? 'действует' : `отозвано ${fmtDateTime(k.revokedAt)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {u.consents.length === 0 && <p className={styles.muted}>Согласий нет.</p>}
      </Panel>
      <Panel className={styles.actions}>
        <h2 className={styles.sectionTitle}>Действия</h2>
        <UserActions
          userId={u.id}
          block={{ blockedAt: u.blockedAt?.toISOString() ?? null, blockedUntil: u.blockedUntil?.toISOString() ?? null, blockedReason: u.blockedReason }}
          can={{ block: can(staff.role, 'block_user'), unblock: can(staff.role, 'unblock_user'), erase: can(staff.role, 'erase_account') }}
        />
      </Panel>
    </>
  );
}
