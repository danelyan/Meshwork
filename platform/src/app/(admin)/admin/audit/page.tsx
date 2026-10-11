import Link from 'next/link';

import { Button } from '@/components/ui';
import ui from '@/components/ui.module.css';
import { listAudit } from '@/server/admin/audit-feed';
import { STAFF_ROLE_LABEL } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../admin.module.css';

type Q = { actorId?: string; action?: string; targetType?: string; targetId?: string; cursor?: string };

const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'Europe/Moscow' });

function short(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = JSON.stringify(v, null, 1);
  return s.length > 600 ? `${s.slice(0, 600)}…` : s;
}

/** Журнал действий персонала (только owner): лента новых сверху, фильтр по сотруднику, действию и объекту. */
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Q> }) {
  await requirePageStaff('/admin/audit', 'view_audit');
  const q = await searchParams;
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);
  const filter = { actorId: pick(q.actorId), action: pick(q.action), targetType: pick(q.targetType), targetId: pick(q.targetId) };
  const { items, nextCursor } = await listAudit({ ...filter, cursor: pick(q.cursor), limit: 50 });
  const nextQs = nextCursor ? new URLSearchParams({ ...Object.fromEntries(Object.entries(filter).filter(([, v]) => v)), cursor: nextCursor }).toString() : null;
  return (
    <>
      <h1 className={styles.title}>Журнал</h1>
      <p className={styles.muted}>Записи неизменяемы: их нельзя поправить или удалить ни из админки, ни в БД.</p>
      <form className={styles.filters} method="get">
        <input className={ui.input} name="action" placeholder="Действие (префикс)" defaultValue={filter.action} aria-label="Действие" />
        <input className={ui.input} name="targetType" placeholder="Тип объекта" defaultValue={filter.targetType} aria-label="Тип объекта" />
        <input className={ui.input} name="targetId" placeholder="id объекта" defaultValue={filter.targetId} aria-label="id объекта" />
        <input className={ui.input} name="actorId" placeholder="id сотрудника" defaultValue={filter.actorId} aria-label="id сотрудника" />
        <Button type="submit" size="sm">Показать</Button>
        <Button href="/admin/audit" variant="ghost" size="sm">Сбросить</Button>
      </form>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Когда (МСК)</th>
            <th>Кто</th>
            <th>Действие</th>
            <th>Объект</th>
            <th>Причина</th>
            <th>До → после</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <td className={styles.mono}>{fmt.format(r.createdAt)}</td>
              <td className={styles.nowrap}>
                {r.actor ? (
                  <Link href={`/admin/audit?actorId=${r.actor.id}`}>{r.actor.name}</Link>
                ) : (
                  'система'
                )}
                {r.actor && <div className={styles.mono}>{STAFF_ROLE_LABEL[r.actor.role]}</div>}
              </td>
              <td className={styles.mono}>{r.action}</td>
              <td className={styles.mono}>{r.targetType ? <Link href={`/admin/audit?targetType=${encodeURIComponent(r.targetType)}&targetId=${encodeURIComponent(r.targetId ?? '')}`}>{`${r.targetType}:${r.targetId ?? ''}`}</Link> : '–'}</td>
              <td>{r.reason ?? '–'}</td>
              <td>
                {(short(r.before) || short(r.after)) ? (
                  <details className={styles.details}>
                    <summary>Показать</summary>
                    {short(r.before) && (
                      <>
                        <p className={styles.jsonLabel}>До</p>
                        <pre className={styles.json}>{short(r.before)}</pre>
                      </>
                    )}
                    {short(r.after) && (
                      <>
                        <p className={styles.jsonLabel}>После</p>
                        <pre className={styles.json}>{short(r.after)}</pre>
                      </>
                    )}
                  </details>
                ) : (
                  '–'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && <p className={styles.muted}>Записей нет.</p>}
      {nextQs && (
        <div className={styles.row}>
          <Button href={`/admin/audit?${nextQs}`} variant="ghost" size="sm">Дальше</Button>
        </div>
      )}
    </>
  );
}
