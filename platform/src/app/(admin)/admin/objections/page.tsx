import { ModerationDecision } from '@/components/admin/ModerationDecision';
import { Button, Tag } from '@/components/ui';
import { listObjectionQueue } from '@/server/admin/moderation/objections';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import m from '../moderation.module.css';

export const dynamic = 'force-dynamic';

const STATUSES = ['open', 'answered', 'all'] as const;
const LABEL: Record<string, string> = { open: 'Открытые', answered: 'С ответом', all: 'Все' };
const SUBJECT: Record<string, string> = { grade_test: 'Тест на грейд', call: 'Созвон', defense: 'Защита' };
const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });

function left(hours: number): string {
  if (hours < 0) return `просрочено на ${Math.ceil(-hours / 24)} дн.`;
  return hours >= 48 ? `осталось ${Math.floor(hours / 24)} дн.` : `осталось ${hours} ч`;
}

/** Возражения против автоматической оценки (152-ФЗ, ст. 16): по сроку ответа, предмет рядом. Категорию вручную не ставим. */
export default async function ObjectionsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const staff = await requirePageStaff('/admin/objections', 'view_objections');
  const q = await searchParams;
  const status = (STATUSES as readonly string[]).includes(q.status ?? '') ? (q.status as (typeof STATUSES)[number]) : 'open';
  const items = await listObjectionQueue(status);
  const canAnswer = can(staff.role, 'answer_objection');
  return (
    <>
      <h1 className={styles.title}>Возражения</h1>
      <p className={styles.muted}>Срок ответа – 30 дней (ст. 16 152-ФЗ). Пересмотр: итоговый ответ даёт другой сотрудник. Аннулирование снимает категорию по попытке, новую не выдаёт.</p>
      <nav className={m.tabs} aria-label="Статус">
        {STATUSES.map((s) => <Button key={s} href={`/admin/objections?status=${s}`} size="sm" variant={s === status ? 'primary' : 'ghost'}>{LABEL[s]}</Button>)}
      </nav>
      <div className={m.list}>
        {items.map((o) => (
          <article key={o.id} className={m.item}>
            <div className={m.head}>
              <strong>{SUBJECT[o.subject] ?? o.subject} · {o.candidate}</strong>
              <span className={styles.mono}>подано {fmt.format(new Date(o.createdAt))} · срок {fmt.format(new Date(o.dueAt))}</span>
              {o.status === 'open' && <span className={o.hoursLeft < 72 ? m.overdue : styles.muted}>{left(o.hoursLeft)}</span>}
              {o.review && <Tag>пересмотр назначен</Tag>}
            </div>
            <blockquote className={m.quote}>{o.text}</blockquote>
            <div>
              <strong>{o.preview.kind}</strong>
              <ul className={m.facts}>{o.preview.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            </div>
            {o.review?.note && <p className={styles.muted}>Заметка к пересмотру: {o.review.note}</p>}
            {o.status === 'open' && canAnswer ? (
              <ModerationDecision
                url={`/api/admin/objections/${o.id}`}
                field="text"
                label="Ответ кандидату (для пересмотра – заметка коллеге)"
                options={[
                  { value: 'answer', label: 'Ответить', variant: 'primary' },
                  ...(o.review ? [] : [{ value: 'review', label: 'Назначить пересмотр' }]),
                  ...(o.preview.attemptId ? [{ value: 'annul', label: 'Аннулировать попытку', variant: 'danger' as const }] : []),
                ]}
              />
            ) : (
              o.answer && <p className={styles.muted}>Ответ: {o.answer}</p>
            )}
          </article>
        ))}
        {items.length === 0 && <p className={styles.muted}>Возражений нет.</p>}
      </div>
    </>
  );
}
