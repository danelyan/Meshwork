import { ModerationDecision } from '@/components/admin/ModerationDecision';
import { companyDisplayName } from '@/lib/company-brand';
import { Button } from '@/components/ui';
import { listAppeals } from '@/server/admin/moderation/appeals';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import m from '../moderation.module.css';

export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'upheld', 'rejected', 'all'] as const;
const LABEL: Record<string, string> = { open: 'Открытые', upheld: 'Удовлетворённые', rejected: 'Отклонённые', all: 'Все' };
const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });

/** Апелляции работодателей на санкцию (E-08, фаза 2): удовлетворить = отклонить открытые жалобы, на которых держится санкция. */
export default async function AppealsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const staff = await requirePageStaff('/admin/appeals', 'view_appeals');
  const q = await searchParams;
  const status = (STATUSES as readonly string[]).includes(q.status ?? '') ? (q.status as (typeof STATUSES)[number]) : 'open';
  const items = await listAppeals(status);
  const canResolve = can(staff.role, 'resolve_appeal');
  return (
    <>
      <h1 className={styles.title}>Апелляции</h1>
      <p className={styles.muted}>Удовлетворённая апелляция отклоняет все открытые жалобы компании за 30 дней (подтверждённые остаются). Работодатель и кандидаты получают письма.</p>
      <nav className={m.tabs} aria-label="Статус">
        {STATUSES.map((s) => <Button key={s} href={`/admin/appeals?status=${s}`} size="sm" variant={s === status ? 'primary' : 'ghost'}>{LABEL[s]}</Button>)}
      </nav>
      <div className={m.list}>
        {items.map((a) => (
          <article key={a.id} className={m.item}>
            <div className={m.head}>
              <strong>{companyDisplayName(a.company.name)}</strong>
              <span className={styles.mono}>{fmt.format(new Date(a.createdAt))}</span>
            </div>
            <blockquote className={m.quote}>{a.text}</blockquote>
            <ul className={m.facts}>
              <li>Санкция: {a.sanction.level === 'none' ? 'нет' : a.sanction.level === 'reduced' ? `лимит ${a.sanction.limit}/сутки` : 'отправка закрыта'} ({a.sanction.complaints} жалоб за 30 дней)</li>
              <li>Открытых: {a.complaints.filter((c) => c.status === 'open').length}, подтверждённых: {a.complaints.filter((c) => c.status === 'upheld').length}</li>
            </ul>
            <ul className={m.facts}>
              {a.complaints.map((c) => <li key={c.id}>{c.candidate}: {c.reason} ({c.status}){c.comment ? ` — ${c.comment}` : ''}</li>)}
            </ul>
            {a.status === 'open' && canResolve ? (
              <ModerationDecision url={`/api/admin/appeals/${a.id}`} options={[{ value: 'upheld', label: 'Удовлетворить', variant: 'primary' }, { value: 'rejected', label: 'Отклонить' }]} />
            ) : (
              a.status !== 'open' && <p className={styles.muted}>{a.status === 'upheld' ? 'Удовлетворена' : 'Отклонена'}: {a.resolution}</p>
            )}
          </article>
        ))}
        {items.length === 0 && <p className={styles.muted}>Апелляций нет.</p>}
      </div>
    </>
  );
}
