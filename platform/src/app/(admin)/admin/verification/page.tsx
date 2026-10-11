import { ModerationDecision } from '@/components/admin/ModerationDecision';
import { Button, Tag } from '@/components/ui';
import { listVerification } from '@/server/admin/moderation/verification';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';
import m from '../moderation.module.css';

export const dynamic = 'force-dynamic';

const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Moscow' });

/** Ручная верификация компаний (E-08, фаза 2; R-D-05 — вне MVP): сверить ИНН и название по выписке или домену почты. */
export default async function VerificationPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const staff = await requirePageStaff('/admin/verification', 'view_verification');
  const q = await searchParams;
  const filter = q.filter === 'verified' ? 'verified' : 'pending';
  const items = await listVerification(filter);
  const canVerify = can(staff.role, 'verify_company');
  return (
    <>
      <h1 className={styles.title}>Верификация компаний</h1>
      <p className={styles.muted}>Без API ФНС: модератор сверяет ИНН и название с выпиской ЕГРЮЛ или доменом подтверждённой почты представителя. Метку «компания проверена» кандидат видит на приглашении.</p>
      <nav className={m.tabs} aria-label="Фильтр">
        <Button href="/admin/verification" size="sm" variant={filter === 'pending' ? 'primary' : 'ghost'}>Ждут проверки</Button>
        <Button href="/admin/verification?filter=verified" size="sm" variant={filter === 'verified' ? 'primary' : 'ghost'}>Проверенные</Button>
      </nav>
      <div className={m.list}>
        {items.map((c) => (
          <article key={c.companyId} className={m.item}>
            <div className={m.head}>
              <strong>{c.name}</strong>
              <span className={styles.mono}>ИНН {c.inn ?? '—'} {c.innValid ? '(контрольная цифра верна)' : '(не проходит проверку)'}</span>
              {c.verifiedAt && <Tag>проверена {fmt.format(new Date(c.verifiedAt))}</Tag>}
            </div>
            <ul className={m.facts}>
              <li>Отрасль: {c.industry ?? '—'}</li>
              <li>Представителей: {c.representatives}</li>
              {c.requestedAt && <li>Запрос: {fmt.format(new Date(c.requestedAt))}</li>}
              {c.evidence && <li>Основание: {c.evidence.method === 'egrul' ? 'выписка ЕГРЮЛ' : `домен почты ${c.evidence.domain ?? ''}`}</li>}
            </ul>
            {c.evidence?.text && <blockquote className={m.quote}>{c.evidence.text}</blockquote>}
            {c.note && <p className={styles.muted}>Заметка: {c.note}</p>}
            {canVerify && (
              <ModerationDecision
                url={`/api/admin/verification/${c.companyId}`}
                label="Что сверено (попадёт в журнал)"
                options={c.verifiedAt ? [{ value: 'revoke', label: 'Снять метку', variant: 'danger' }] : [{ value: 'verify', label: 'Подтвердить', variant: 'primary' }, { value: 'reject', label: 'Отклонить запрос' }]}
              />
            )}
          </article>
        ))}
        {items.length === 0 && <p className={styles.muted}>Пусто.</p>}
      </div>
    </>
  );
}
