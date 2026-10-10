'use client';

import { useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api';
import { CompanyFieldsError, updateCompanyApi, type CompanyBody } from '@/lib/employer-api';

import { Button, Field, Notice, Panel } from '../ui';
import ui from '../ui.module.css';

import styles from './Employer.module.css';

const toForm = (c: CompanyBody) => ({
  name: c.name,
  description: c.description ?? '',
  industry: c.industry ?? '',
  inn: c.inn ?? '',
  contact: c.contact ?? '',
});

/** Профиль компании (R-E-01): правка названия, описания, отрасли, ИНН и контакта. Проверки - на сервере. */
export function CompanyForm({ company }: { company: CompanyBody }) {
  const [saved, setSaved] = useState(toForm(company));
  const [form, setForm] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Partial<Record<keyof CompanyBody, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const dirty = (Object.keys(form) as (keyof typeof form)[]).some((k) => form[k] !== saved[k]);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setDone(false);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    setDone(false);
    try {
      const r = await updateCompanyApi(form);
      const next = toForm(r);
      setSaved(next);
      setForm(next);
      setDone(true);
    } catch (err) {
      if (err instanceof CompanyFieldsError) {
        setFields(err.fields);
        setError(err.message);
      } else setError(err instanceof ApiError ? err.message : 'Не удалось сохранить профиль компании');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={styles.card} aria-labelledby="company-title">
      <h2 id="company-title" className={styles.sectionTitle}>
        Данные компании
      </h2>
      <form className={styles.form} onSubmit={submit} noValidate aria-label="Профиль компании">
        <Field label="Название" hint="Так компанию увидят кандидаты в приглашении." error={fields.name}>
          <input className={ui.input} value={form.name} maxLength={120} autoComplete="organization" onChange={set('name')} />
        </Field>
        <Field label="О компании" hint="Чем занимается, продукт, масштаб. До 600 символов." error={fields.description}>
          <textarea className={ui.input} rows={4} maxLength={600} value={form.description} onChange={set('description')} />
        </Field>
        <div className={styles.row}>
          <Field label="Направление" hint="Отрасль: финтех, e-commerce, медиа..." error={fields.industry}>
            <input className={ui.input} value={form.industry} maxLength={80} onChange={set('industry')} />
          </Field>
          <Field label="ИНН" hint="10 цифр у организации, 12 у ИП." error={fields.inn}>
            <input className={ui.input} value={form.inn} maxLength={12} inputMode="numeric" onChange={set('inn')} />
          </Field>
        </div>
        <Field label="Контакт" hint="Почта или Telegram: кандидат увидит его, приняв приглашение." error={fields.contact}>
          <input className={ui.input} value={form.contact} maxLength={120} placeholder="name@mail.ru или @username" onChange={set('contact')} />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        {done && <Notice>Профиль компании сохранён.</Notice>}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>
            Сохранить
          </Button>
        </div>
      </form>
    </Panel>
  );
}
