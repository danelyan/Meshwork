'use client';

import { useState } from 'react';

import { Button, Notice, Panel, Tag } from '@/components/ui';
import ui from '@/components/ui.module.css';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from './adminFetch';

export interface SettingRow {
  key: string;
  group: string;
  title: string;
  description: string;
  unit: string | null;
  value: unknown;
  defaultValue: unknown;
  overridden: boolean;
  updatedAt: string | null;
  updatedBy: { id: string; name: string } | null;
}

interface VersionRow {
  id: string;
  value: unknown;
  reason: string | null;
  createdAt: string;
  updatedBy: { id: string; name: string } | null;
}

const fmt = (v: unknown) => (typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
const when = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });

/** Настройки платформы: правка с обязательной причиной, возврат умолчания, история и откат на версию. */
export function SettingsManager({ groups, initial, canEdit }: { groups: readonly { id: string; title: string }[]; initial: SettingRow[]; canEdit: boolean }) {
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const r = await adminFetch<{ settings: SettingRow[] }>('/api/admin/settings');
    setRows(r.settings);
  }

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      {groups.map((g) => (
        <section key={g.id} className={styles.form}>
          <h2 className={styles.title}>{g.title}</h2>
          {rows
            .filter((r) => r.group === g.id)
            .map((r) => (
              <SettingCard key={r.key} row={r} canEdit={canEdit} onError={setError} onChanged={reload} />
            ))}
        </section>
      ))}
    </>
  );
}

function SettingCard({ row, canEdit, onError, onChanged }: { row: SettingRow; canEdit: boolean; onError: (m: string | null) => void; onChanged: () => Promise<void> }) {
  const [text, setText] = useState(fmt(row.value));
  const [reason, setReason] = useState('');
  const [versions, setVersions] = useState<VersionRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    onError(null);
    try {
      await fn();
      setReason('');
      setVersions(null);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  const parse = (): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`«${row.title}»: значение не разобрать, ожидается число или JSON`);
    }
  };
  const save = () => run(() => adminFetch(`/api/admin/settings/${row.key}`, { method: 'PUT', body: { value: parse(), reason } }));
  const toDefault = () => run(() => adminFetch(`/api/admin/settings/${row.key}/rollback`, { body: { toDefault: true, reason } }));
  const rollback = (versionId: string) => run(() => adminFetch(`/api/admin/settings/${row.key}/rollback`, { body: { versionId, reason } }));
  async function loadHistory() {
    try {
      setVersions((await adminFetch<{ versions: VersionRow[] }>(`/api/admin/settings/${row.key}`)).versions);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Ошибка');
    }
  }
  const structured = typeof row.defaultValue === 'object' && row.defaultValue !== null;

  return (
    <Panel className={styles.form} data-testid={`setting-${row.key}`}>
      <div className={styles.row}>
        <strong>{row.title}</strong>
        <span className={styles.mono}>{row.key}</span>
        {row.overridden ? <Tag tone="solid">изменено</Tag> : <Tag tone="outline">умолчание</Tag>}
      </div>
      <p className={styles.muted}>{row.description}</p>
      <p className={styles.muted}>
        Сейчас: <span className={styles.mono}>{fmt(row.value)}</span>
        {row.unit ? ` ${row.unit}` : ''} · умолчание в коде: <span className={styles.mono}>{fmt(row.defaultValue)}</span>
        {row.updatedBy && row.updatedAt ? ` · менял ${row.updatedBy.name}, ${when(row.updatedAt)}` : ''}
      </p>
      {canEdit && (
        <div className={styles.filters}>
          {structured ? (
            <textarea className={ui.input} rows={3} aria-label={`Значение ${row.title}`} value={text} onChange={(e) => setText(e.target.value)} />
          ) : (
            <input className={ui.input} aria-label={`Значение ${row.title}`} value={text} onChange={(e) => setText(e.target.value)} />
          )}
          <input className={ui.input} aria-label={`Причина ${row.title}`} placeholder="Причина (обязательна, в журнал)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" loading={busy} disabled={reason.trim().length < 5} onClick={() => void save()}>
            Сохранить
          </Button>
          <Button size="sm" variant="ghost" disabled={busy || reason.trim().length < 5} onClick={() => void toDefault()}>
            Вернуть умолчание
          </Button>
        </div>
      )}
      <div className={styles.row}>
        <Button size="sm" variant="ghost" onClick={() => void loadHistory()}>
          История
        </Button>
      </div>
      {versions && (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Когда</th>
              <th>Кто</th>
              <th>Значение</th>
              <th>Причина</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {versions.length === 0 && (
              <tr>
                <td colSpan={5}>Изменений не было: действует умолчание из кода.</td>
              </tr>
            )}
            {versions.map((v) => (
              <tr key={v.id}>
                <td>{when(v.createdAt)}</td>
                <td>{v.updatedBy?.name ?? '-'}</td>
                <td className={styles.mono}>{fmt(v.value)}</td>
                <td>{v.reason}</td>
                <td>
                  {canEdit && (
                    <Button size="sm" variant="ghost" disabled={busy || reason.trim().length < 5} onClick={() => void rollback(v.id)}>
                      Откатить
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {versions && canEdit && <p className={styles.muted}>Откат и возврат умолчания требуют причины (поле выше).</p>}
    </Panel>
  );
}
