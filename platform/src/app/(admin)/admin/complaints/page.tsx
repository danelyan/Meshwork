import { ModerationDecision } from '@/components/admin/ModerationDecision';
import { Button, Tag } from '@/components/ui';
import { can } from '@/server/admin/permissions';
import { listComplaints } from '@/server/admin/moderation/complaints';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import m from '../moderation.module.css';

export const dynamic = 'force-dynamic';

const REASON: Record<string, string> = { spam: 'Спам', salary_mismatch: 'Вилка не совпадает', offensive: 'Оскорбление', fake_company: 'Фейковая компания', other: 'Другое' };
const STATUSES = ['open', 'upheld', 'dismissed', 'all'] as const;
const LABEL: Record<string, string> = { open: 'Открытые', upheld: 'Подтверждённые', dismissed: 'Отклонённые', all: 'Все' };
const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });

/** Очередь жалоб кандидатов (E-08, фаза 2): решение upheld/dismissed с причиной, пересчёт санкции под lock отправки. */
export default async function ComplaintsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const staff = await requirePageStaff('/admin/complaints', 'view_complaints');
  const q = await searchParams;
  const status = (STATUSES as readonly string[]).includes(q.status ?? '') ? (q.status as (typeof STATUSES)[number]) : 'open';
  const items = await listComplaints(status);
  const canResolve = can(staff.role, 'resolve_complaint');
  return (
    <>
      <h1 className={styles.title}>Жалобы</h1>
      <p className={styles.muted}>Отклонённая жалоба сразу перестаёт снижать лимит приглашений и индекс доверия компании. Кандидат получает письмо с итогом.</p>
      <nav className={m.tabs} aria-label="Статус">
        {STATUSES.map((s) => <Button key={s} href={`/admin/complaints?status=${s}`} size="sm" variant={s === status ? 'primary' : 'ghost'}>{LABEL[s]}</Button>)}
      </nav>
      <div className={m.list}>
        {items.map((c) => (
          <article key={c.id} className={m.item}>
            <div className={m.head}>
              <strong>{c.company.name}</strong>
              <span className={styles.mono}>{fmt.format(new Date(c.createdAt))} · {c.candidate}</span>
              <Tag>{REASON[c.reason] ?? c.reason}</Tag>
            </div>
            {c.comment && <blockquote className={m.quote}>{c.comment}</blockquote>}
            <ul className={m.facts}>
              <li>Приглашение: {c.invitation.vacancyTitle ?? 'без вакансии'}, {c.invitation.salaryFrom}–{c.invitation.salaryTo} ₽, статус {c.invitation.status}</li>
              <li>История компании: открытых {c.companyHistory.open}, подтверждённых {c.companyHistory.upheld}, отклонённых {c.companyHistory.dismissed}</li>
              <li>Та же причина от других кандидатов: {c.companyHistory.sameReasonOtherCandidates}</li>
              <li>Санкция сейчас: {c.sanction.level === 'none' ? 'нет' : c.sanction.level === 'reduced' ? `лимит ${c.sanction.limit}/сутки` : 'отправка закрыта'} ({c.sanction.complaints} за 30 дней)</li>
            </ul>
            {c.invitation.message && <blockquote className={m.quote}>{c.invitation.message}</blockquote>}
            {c.status === 'open' && canResolve ? (
              <ModerationDecision url={`/api/admin/complaints/${c.id}`} options={[{ value: 'upheld', label: 'Подтвердить', variant: 'danger' }, { value: 'dismissed', label: 'Отклонить' }]} />
            ) : (
              c.status !== 'open' && <p className={styles.muted}>{c.status === 'upheld' ? 'Подтверждена' : 'Отклонена'}{c.resolvedAt ? ` ${fmt.format(new Date(c.resolvedAt))}` : ''}: {c.resolution}</p>
            )}
          </article>
        ))}
        {items.length === 0 && <p className={styles.muted}>Жалоб нет.</p>}
      </div>
    </>
  );
}
