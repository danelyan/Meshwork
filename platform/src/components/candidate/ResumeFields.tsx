'use client';

import { useState } from 'react';
import { postJson } from '@/lib/api';
import type { ProfileDetails } from '@/server/claims/profile-details';
import type { ResumeFieldView } from '@/server/resume-fields';
import { Button, Field, Notice, Panel } from '../ui';
import styles from './Candidate.module.css';

type Key = ResumeFieldView['key'];
type Value = ResumeFieldView['resume'] | null;

const LABEL: Record<Key, string> = { name: 'ФИО', contact: 'Контакт', experienceYears: 'Стаж, лет', roles: 'Роли', softSkills: 'Софт-скиллы' };
const KEYS: Key[] = ['name', 'contact', 'experienceYears', 'roles', 'softSkills'];
const show = (v: Value) => (v === null || v === undefined || (Array.isArray(v) && v.length === 0) ? null : Array.isArray(v) ? v.join(', ') : String(v));

/**
 * R-C-01/02: поля, распознанные в резюме. Пометка «из резюме» у взятых в пустые поля; «в резюме указано иначе» —
 * предложение, если кандидат заполнил поле сам. ФИО и контакт компаниям не видны до принятия приглашения.
 */
export function ResumeFieldsCard({ details, onChange }: { details: ProfileDetails | null; onChange?: () => void }) {
  const [fields, setFields] = useState<ResumeFieldView[] | null>(null);
  const [current, setCurrent] = useState<Partial<Record<Key, Value>>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Record<Key, string>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!details) return null;
  const views = fields ?? details.resumeFields ?? [];
  const value = (k: Key): Value =>
    k in current ? (current[k] ?? null)
    : k === 'name' ? details.name
    : k === 'contact' ? details.contact
    : k === 'experienceYears' ? (details.basics?.experienceYears ?? null)
    : (details.basics?.[k] ?? null);

  async function act(body: Record<string, unknown>, patch?: Partial<Record<Key, Value>>) {
    setBusy(true); setError(null);
    try {
      const res = await postJson<{ fields: ResumeFieldView[] }>('/api/profile/resume-fields', body);
      setFields(res.fields);
      if (patch) setCurrent((c) => ({ ...c, ...patch }));
      onChange?.();
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить'); }
    finally { setBusy(false); }
  }
  async function save() {
    const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
    for (const k of ['name', 'experienceYears', 'roles', 'softSkills'] as const) {
      const d = draft[k];
      if (d === undefined) continue;
      const v = k === 'roles' || k === 'softSkills' ? list(d) : k === 'experienceYears' ? (d.trim() === '' ? null : Number(d)) : d.trim();
      await act({ action: 'set', key: k, value: v }, { [k]: v });
    }
    setDraft({}); setEditing(false);
  }

  return <Panel className={styles.basicCard}>
    <div className={styles.sectionLabel}><span>Из резюме</span><Button size="sm" disabled={busy} onClick={() => (editing ? void save() : setEditing(true))}>{editing ? 'Сохранить' : 'Изменить'}</Button></div>
    {error && <Notice tone="error">{error}</Notice>}
    <dl className={styles.basicFacts}>{KEYS.map((k) => {
      const v = views.find((f) => f.key === k);
      return <div key={k} data-testid={`resume-field-${k}`}>
        <dt>{LABEL[k]}{v?.fromResume && <span title={v.quote}>из резюме</span>}{(k === 'name' || k === 'contact') && <span data-private="true">скрыто от компаний</span>}</dt>
        <dd>
          {editing && k !== 'contact'
            ? <Field label={LABEL[k]}><input defaultValue={show(value(k)) ?? ''} inputMode={k === 'experienceYears' ? 'numeric' : undefined} placeholder={k === 'roles' || k === 'softSkills' ? 'через запятую' : undefined} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))} /></Field>
            : show(value(k)) || 'Не указано'}
          {k === 'contact' && editing && <Button size="sm" href="/settings">Изменить в настройках ↗</Button>}
          {v?.fromResume && <small className={styles.meta}>«{v.quote.split('\n')[0]}»</small>}
          {v?.suggestion && <Notice>
            В резюме указано иначе: <strong>{show(v.resume)}</strong> <small>(«{v.quote.split('\n')[0]}»)</small>{' '}
            <Button size="sm" disabled={busy} onClick={() => void act({ action: 'accept', key: k }, { [k]: v.resume })}>Взять из резюме</Button>{' '}
            <Button size="sm" disabled={busy} onClick={() => void act({ action: 'dismiss', key: k })}>Оставить моё</Button>
          </Notice>}
        </dd>
      </div>;
    })}</dl>
    <p className={styles.meta}>Стаж, роли (без названий компаний) и софт-скиллы компании видят в анонимной карточке; ФИО и контакт — только после принятия приглашения.</p>
  </Panel>;
}
