'use client';

import { useEffect, useState } from 'react';
import { companyDisplayName } from '@/lib/company-brand';

import { APPLICATION_STATUS_LABEL, applyApi, myApplicationsApi } from '@/lib/applications-api';
import { CONSENT_TEXTS } from '@/server/consent/texts';
import type { CandidateApplicationView } from '@/server/employer/applications';
import { APPLICATION_MESSAGE_MAX } from '@/server/employer/application-schemas';

import { Button, Field, Notice } from '../ui';
import ui from '../ui.module.css';
import styles from './Candidate.module.css';

/**
 * Самоотклик на выбранную вакансию (R-C-12) — дополнение к приглашениям. Галочка раскрытия (Г5) обязательна:
 * компания увидит имя и контакт, только если примет отклик (R-E-07); до этого — псевдоним, как в подборке.
 */
export function ApplyPanel({ vacancyId, companyName }: { vacancyId: string; companyName: string }) {
  const [mine, setMine] = useState<CandidateApplicationView | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disclosure = CONSENT_TEXTS.identity_disclosure;

  useEffect(() => {
    let alive = true;
    setMine(undefined);
    myApplicationsApi().then(
      (res) => alive && setMine(res?.applications?.find((a) => a.vacancy.id === vacancyId) ?? null),
      () => alive && setMine(null),
    );
    return () => { alive = false; };
  }, [vacancyId]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await applyApi(vacancyId, message, disclosure.version);
      const res = await myApplicationsApi();
      setMine(res?.applications?.find((a) => a.vacancy.id === vacancyId) ?? null);
      setOpen(false);
    } catch (err) { setError(err instanceof Error ? err.message : 'Не удалось отправить отклик.'); }
    finally { setBusy(false); }
  }

  if (mine === undefined) return null;
  if (mine) return <p role="status" data-testid="application-status">Отклик {APPLICATION_STATUS_LABEL[mine.status]}. Статус — в разделе <a href="/invitations">«Приглашения»</a>, блок «Мои отклики».</p>;
  if (!open) return <Button variant="primary" onClick={() => setOpen(true)}>Откликнуться</Button>;
  return <div className={styles.stack} data-testid="apply-form">
    <Field label={`Сообщение компании (до ${APPLICATION_MESSAGE_MAX} символов, необязательно)`}>
      <textarea className={ui.input} rows={4} maxLength={APPLICATION_MESSAGE_MAX} value={message} onChange={(e) => setMessage(e.target.value)} />
    </Field>
    <label className={styles.fine}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> {disclosure.label} ({companyDisplayName(companyName)}), если компания примет отклик. До этого она видит анонимную карточку, как в подборке. {disclosure.paragraphs[1]}</label>
    {error && <Notice tone="error">{error}</Notice>}
    <div className={styles.actions}><Button variant="primary" disabled={!agree || busy} loading={busy} onClick={() => void submit()}>Отправить отклик</Button><Button disabled={busy} onClick={() => setOpen(false)}>Отмена</Button></div>
  </div>;
}
