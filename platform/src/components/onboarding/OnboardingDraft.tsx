'use client';

import { useState } from 'react';
import type { OnboardingView } from '@/server/onboarding/types';
import { Button } from '@/components/ui';
import styles from './OnboardingDraft.module.css';

/** Live answers only. Company privacy copy describes policy rather than exposing raw questionnaire text. */
export function OnboardingDraft({ view, busy, onEdit }: { view: OnboardingView; busy: boolean; onEdit: (id: string) => void }) {
  const [privacy, setPrivacy] = useState(false);
  const [open, setOpen] = useState(false);
  return <details className={styles.draft} onToggle={(e) => setOpen(e.currentTarget.open)}>
    <summary><span><small>Что я сохраняю</small>Черновик профиля</span><b>{view.progress.done}/{view.progress.total}</b></summary>
    {open && <><div className={styles.tabs} role="group" aria-label="Вид черновика">
      <Button size="sm" variant={privacy ? 'ghost' : 'primary'} aria-pressed={!privacy} onClick={() => setPrivacy(false)}>Мои ответы</Button>
      <Button size="sm" variant={privacy ? 'primary' : 'ghost'} aria-pressed={privacy} onClick={() => setPrivacy(true)}>Кто увидит</Button>
    </div>
    {privacy ? <div className={styles.privacy}>
      <p>{view.scenario === 'employer' ? 'Кандидат видит сведения о компании, контакт и зарплатную вилку в приглашении. Черновик потребности сохраняется только по вашему подтверждению.' : 'Компания видит анонимную карточку: направление, подтверждённые навыки и результаты оценки. Имя и контакт открываются этой компании после принятия приглашения.'}</p>
      <p>Цель, предполагаемый грейд, исходные документы и реплики чата не становятся публичным профилем. Пропущенный ответ не считается заполненным.</p>
      <Button href="/consent" variant="ghost" size="sm">Текст согласия</Button>
    </div> : <div className={styles.rows}>
      {view.history.length === 0 && <p className={styles.empty}>Ответы появятся здесь по мере знакомства.</p>}
      {view.history.map((row) => <div className={styles.row} key={row.stepId}>
        <div><small>{row.label || row.question}</small><p>{row.answer || 'Пропущено'}</p></div>
        {row.editable && <Button variant="ghost" size="sm" disabled={busy} aria-label={`Изменить: ${row.label || row.question}`} onClick={() => onEdit(row.stepId)}>Изменить</Button>}
      </div>)}
      {view.current.kind !== 'summary' && <div className={styles.current}><small>Сейчас заполняем</small><strong>{view.current.label}</strong></div>}
    </div>}</>}
  </details>;
}
