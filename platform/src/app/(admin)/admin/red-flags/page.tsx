import { ModerationDecision } from '@/components/admin/ModerationDecision';
import { Button, Tag } from '@/components/ui';
import { listRedFlags } from '@/server/admin/moderation/red-flags';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import m from '../moderation.module.css';

export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'ok', 'hidden', 'warned', 'all'] as const;
const LABEL: Record<string, string> = { open: 'Открытые', ok: 'Норм', hidden: 'Скрытые', warned: 'С предупреждением', all: 'Все' };
const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });

/** Красные флаги (E-08, фаза 2; R-X-01): приглашения и вакансии, где сработал detectRedFlags. */
export default async function RedFlagsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const staff = await requirePageStaff('/admin/red-flags', 'view_red_flags');
  const q = await searchParams;
  const status = (STATUSES as readonly string[]).includes(q.status ?? '') ? (q.status as (typeof STATUSES)[number]) : 'open';
  const items = await listRedFlags(status);
  const canReview = can(staff.role, 'review_red_flag');
  return (
    <>
      <h1 className={styles.title}>Красные флаги</h1>
      <p className={styles.muted}>Флаг — повод посмотреть, не вердикт. Скрытая вакансия пропадает у кандидатов; предупреждение уходит письмом представителям компании.</p>
      <nav className={m.tabs} aria-label="Статус">
        {STATUSES.map((s) => <Button key={s} href={`/admin/red-flags?status=${s}`} size="sm" variant={s === status ? 'primary' : 'ghost'}>{LABEL[s]}</Button>)}
      </nav>
      <div className={m.list}>
        {items.map((r) => (
          <article key={r.id} className={m.item}>
            <div className={m.head}>
              <strong>{r.targetType === 'vacancy' ? 'Вакансия' : 'Приглашение'}: {r.title ?? '—'} · {r.company?.name ?? '—'}</strong>
              <span className={styles.mono}>{fmt.format(new Date(r.createdAt))} · {r.salary}</span>
            </div>
            <div className={styles.row}>{r.flags.map((f) => <Tag key={f.code} title={f.reason}>{f.code} · {f.severity}</Tag>)}</div>
            {r.text && <blockquote className={m.quote}>{r.text}</blockquote>}
            {r.status === 'open' && canReview ? (
              <ModerationDecision
                url={`/api/admin/red-flags/${r.id}`}
                options={[
                  { value: 'ok', label: 'Норм', variant: 'primary' },
                  ...(r.targetType === 'vacancy' ? [{ value: 'hidden', label: 'Скрыть вакансию', variant: 'danger' as const }] : []),
                  { value: 'warned', label: 'Предупредить компанию' },
                ]}
              />
            ) : (
              r.status !== 'open' && <p className={styles.muted}>{LABEL[r.status]}: {r.resolution}</p>
            )}
          </article>
        ))}
        {items.length === 0 && <p className={styles.muted}>Флагов нет.</p>}
      </div>
    </>
  );
}
