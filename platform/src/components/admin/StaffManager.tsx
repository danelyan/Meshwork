'use client';

import { useState } from 'react';

import { Button, Field, Notice, Panel, Tag } from '@/components/ui';
import ui from '@/components/ui.module.css';
import { STAFF_ROLES, STAFF_ROLE_LABEL, type StaffRoleName } from '@/server/admin/permissions';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from './adminFetch';

export interface StaffRow {
  id: string;
  email: string;
  name: string;
  role: StaffRoleName;
  totpEnabledAt: string | null;
  disabledAt: string | null;
  createdAt: string;
}

type Patch = { role: StaffRoleName } | { disabled: boolean } | { resetTotp: true };

/** Управление персоналом (owner). Причина — через prompt: она обязательна и уходит в журнал. */
export function StaffManager({ initial, meId }: { initial: StaffRow[]; meId: string }) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState({ email: '', name: '', role: 'support' as StaffRoleName });
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function patch(id: string, body: Patch, question: string) {
    const reason = window.prompt(`${question}\nПричина (попадёт в журнал):`);
    if (!reason) return;
    setError(null);
    try {
      const { staff } = await adminFetch<{ staff: StaffRow }>(`/api/admin/staff/${id}`, { method: 'PATCH', body: { ...body, reason } });
      setRows((rs) => rs.map((r) => (r.id === id ? staff : r)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  }

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Сотрудник</th>
            <th>Роль</th>
            <th>2FA</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                {r.name}
                <div className={styles.mono}>{r.email}</div>
              </td>
              <td>
                {r.id === meId ? (
                  STAFF_ROLE_LABEL[r.role]
                ) : (
                  <select className={ui.input} aria-label={`Роль ${r.name}`} value={r.role} onChange={(e) => void patch(r.id, { role: e.target.value as StaffRoleName }, `Сменить роль ${r.name} на «${STAFF_ROLE_LABEL[e.target.value as StaffRoleName]}»?`)}>
                    {STAFF_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {STAFF_ROLE_LABEL[role]}
                      </option>
                    ))}
                  </select>
                )}
              </td>
              <td>{r.totpEnabledAt ? <Tag tone="outline">включена</Tag> : <Tag tone="dashed">не настроена</Tag>}</td>
              <td>{r.disabledAt ? <Tag tone="dashed">отключён</Tag> : <Tag>активен</Tag>}</td>
              <td>
                {r.id !== meId && (
                  <div className={styles.row}>
                    <Button size="sm" variant={r.disabledAt ? 'ghost' : 'danger'} onClick={() => void patch(r.id, { disabled: !r.disabledAt }, r.disabledAt ? `Включить ${r.name}?` : `Отключить ${r.name}?`)}>
                      {r.disabledAt ? 'Включить' : 'Отключить'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void patch(r.id, { resetTotp: true }, `Сбросить 2FA у ${r.name}? При следующем входе он настроит её заново.`)}>
                      Сбросить 2FA
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Panel className={styles.card}>
        <h2 className={styles.title}>Пригласить</h2>
        <form
          className={styles.form}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const r = await adminFetch<{ staff: StaffRow; temporaryPassword: string }>('/api/admin/staff', { body: invite });
              setRows((rs) => [...rs, r.staff]);
              setCreated({ email: r.staff.email, password: r.temporaryPassword });
              setInvite({ email: '', name: '', role: 'support' });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Ошибка');
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Почта">
            <input className={ui.input} type="email" required value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          </Field>
          <Field label="Имя">
            <input className={ui.input} required value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
          </Field>
          <Field label="Роль">
            <select className={ui.input} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as StaffRoleName })}>
              {STAFF_ROLES.map((role) => (
                <option key={role} value={role}>
                  {STAFF_ROLE_LABEL[role]}
                </option>
              ))}
            </select>
          </Field>
          <Button type="submit" loading={busy}>Создать учётку</Button>
        </form>
        {created && (
          <Notice>
            Временный пароль для {created.email} показан один раз — передайте его лично: <code className={styles.secret}>{created.password}</code> Сотрудник меняет его и настраивает 2FA при первом входе.
          </Notice>
        )}
      </Panel>
    </>
  );
}
