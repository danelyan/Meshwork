'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button, Field, Notice, Segmented, Tag } from '@/components/ui';
import ui from '@/components/ui.module.css';
import { postJson } from '@/lib/api';

import styles from './Employer.module.css';

export interface VerificationState {
  verified: boolean;
  verifiedAt: string | null;
  requestedAt: string | null;
  note: string | null;
}

/**
 * lane admin (E-08, фаза 2): запрос ручной проверки компании модератором — реквизиты выписки ЕГРЮЛ или домен
 * подтверждённой корпоративной почты. Метку «компания проверена» кандидат видит на приглашении.
 */
export function CompanyVerification({ state }: { state: VerificationState }) {
  const router = useRouter();
  const [method, setMethod] = useState<'egrul' | 'email_domain'>('egrul');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await postJson('/api/employer/company/verification', { method, text });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.companyProfile} aria-label="Проверка компании" data-testid="company-verification">
      <div className={styles.explorerBar}><span className={styles.status}>Проверка компании</span>{state.verified && <Tag>Компания проверена</Tag>}</div>
      {state.verified ? (
        <p>Модератор сверил ИНН и название. Кандидаты видят метку «Компания проверена» в приглашениях.</p>
      ) : state.requestedAt ? (
        <p>Запрос отправлен {new Date(state.requestedAt).toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}. Модератор сверит ИНН и название вручную.</p>
      ) : (
        <>
          {state.note && <Notice tone="error">Прошлый запрос отклонён: {state.note}</Notice>}
          <p>Проверка ручная: модератор сверяет ИНН и название. Кандидаты увидят метку «Компания проверена».</p>
          <Segmented label="Основание" value={method} onChange={setMethod} options={[{ value: 'egrul', label: 'Выписка ЕГРЮЛ' }, { value: 'email_domain', label: 'Домен почты' }]} />
          <Field label={method === 'egrul' ? 'Реквизиты выписки: ОГРН, дата, ссылка' : 'Комментарий (домен возьмём из подтверждённой почты аккаунта)'}>
            <textarea className={ui.input} rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} />
          </Field>
          <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={() => void submit()}>Запросить проверку</Button>
          {error && <Notice tone="error">{error}</Notice>}
        </>
      )}
    </section>
  );
}
