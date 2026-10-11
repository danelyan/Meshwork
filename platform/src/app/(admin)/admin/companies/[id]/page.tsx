import Link from 'next/link';
import { companyDisplayName, companyDisplayDescription } from '@/lib/company-brand';

import { CompanyActions } from '@/components/admin/actions';
import { RevealPii } from '@/components/admin/RevealPii';
import { COMPLAINT_REASON_LABEL, COMPLAINT_STATUS_LABEL, GRADE_LABEL, INVITATION_STATUS_LABEL, SPEC_LABEL, fmtDate, fmtDateTime, pct } from '@/components/admin/labels';
import { Panel, Tag } from '@/components/ui';
import { isBlockedNow } from '@/server/admin/accounts/state';
import { getCompanyCard } from '@/server/admin/overview/cards';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../../admin.module.css';
import { orNotFound } from '../../listing';

const LEVEL = { none: 'обычный лимит', reduced: 'сниженный лимит', blocked: 'отправка закрыта' } as const;

/** Карточка компании: профиль, ИНН, представители, потребности, приглашения, жалобы, индекс доверия, санкция. */
export default async function AdminCompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageStaff(`/admin/companies/${id}`, 'view_companies');
  const c = await orNotFound(getCompanyCard(id));
  return (
    <>
      <h1 className={styles.title}>{companyDisplayName(c.name)}</h1>
      <Panel className={styles.section}>
        <dl className={styles.kv}>
          <dt>id</dt>
          <dd className={styles.mono}>{c.id}</dd>
          <dt>Отрасль</dt>
          <dd>{c.industry ?? '—'}</dd>
          <dt>Описание</dt>
          <dd>{companyDisplayDescription(c.name, c.description) ?? '–'}</dd>
          <dt>ИНН</dt>
          <dd>
            <span className={styles.mono}>{c.inn ?? '—'}</span>
            {c.innCheck && <> {c.innCheck.valid ? <Tag tone="outline">контрольная цифра верна</Tag> : <Tag tone="dashed">контрольная цифра не сходится</Tag>} <span className={styles.muted}>{c.innCheck.note}</span></>}
          </dd>
          <dt>Проверка модератором</dt>
          <dd>{c.verifiedAt ? `проверена ${fmtDateTime(c.verifiedAt)}${c.verificationNote ? `: ${c.verificationNote}` : ''}` : c.verificationRequestedAt ? `запрошена ${fmtDateTime(c.verificationRequestedAt)}` : 'не проверена'}</dd>
          <dt>Блокировка</dt>
          <dd>{isBlockedNow(c) && c.blockedAt ? `с ${fmtDateTime(c.blockedAt)}${c.blockedUntil ? ` до ${fmtDateTime(c.blockedUntil)}` : ' бессрочно'}: ${c.blockedReason ?? ''}` : 'нет'}</dd>
          <dt>Санкция по жалобам</dt>
          <dd>
            {LEVEL[c.sanction.level]}: жалоб за 30 дней {c.sanction.complaints}, лимит приглашений в сутки {c.sanction.limit}. Апелляций: {c.appeals}.
          </dd>
        </dl>
        {c.isDemo && <Tag>демо</Tag>}
        <RevealPii url={`/api/admin/companies/${c.id}/pii`} canReveal={can(staff.role, 'reveal_pii')} />
      </Panel>

      {c.trust && (
        <Panel className={styles.section}>
          <h2 className={styles.sectionTitle}>Индекс доверия: {c.trust.index} из 100</h2>
          <p className={styles.muted}>Концепция: веса не калибровались. Считает server/employer, здесь только показ.</p>
          <table className={styles.table}>
            <tbody>
              {c.trust.signals.map((s) => (
                <tr key={s.code}>
                  <td>{s.label}</td>
                  <td className={styles.mono}>{s.points > 0 ? `${s.earned} из ${s.points}` : s.earned}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Представители ({c.representatives.length})</h2>
        <table className={styles.table}>
          <tbody>
            {c.representatives.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/users/${r.userId}`}>{r.name ?? r.userId}</Link>
                </td>
                <td className={styles.mono}>{r.email ?? '—'}</td>
                <td className={styles.mono}>{fmtDate(r.createdAt)}</td>
                <td>{r.blocked ? <Tag tone="dashed">заблокирован</Tag> : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Приглашения</h2>
        <p>
          Отправлено: {c.invitationStats.sent}. Отклонено: {c.invitationStats.declined} ({pct(c.invitationStats.declineShare)}).{' '}
          {Object.entries(c.invitationStats.byStatus).map(([k, n]) => `${INVITATION_STATUS_LABEL[k] ?? k} ${n}`).join(', ')}
        </p>
        <Link href={`/admin/invitations?companyId=${c.id}`}>Все приглашения компании</Link>
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Потребности ({c.vacancies.length})</h2>
        <table className={styles.table}>
          <tbody>
            {c.vacancies.map((v) => (
              <tr key={v.id}>
                <td>
                  <Link href={`/admin/vacancies/${v.id}`}>{v.title}</Link>
                </td>
                <td>{`${SPEC_LABEL[v.specialization]} · ${GRADE_LABEL[v.grade]}`}</td>
                <td className={styles.mono}>{fmtDate(v.createdAt)}</td>
                <td>{v.archivedAt ? 'в архиве' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Жалобы ({c.complaints.length})</h2>
        <ul>
          {c.complaints.map((k) => (
            <li key={k.id}>
              <Link href={`/admin/invitations/${k.invitationId}`}>{fmtDate(k.createdAt)}</Link>: {COMPLAINT_REASON_LABEL[k.reason]}, {COMPLAINT_STATUS_LABEL[k.status]}
            </li>
          ))}
        </ul>
        {c.complaints.length === 0 && <p className={styles.muted}>Жалоб нет.</p>}
      </Panel>

      <Panel className={styles.actions}>
        <h2 className={styles.sectionTitle}>Действия</h2>
        <CompanyActions
          companyId={c.id}
          block={{ blockedAt: c.blockedAt?.toISOString() ?? null, blockedUntil: c.blockedUntil?.toISOString() ?? null, blockedReason: c.blockedReason }}
          canBlock={can(staff.role, 'block_company')}
        />
      </Panel>
    </>
  );
}
