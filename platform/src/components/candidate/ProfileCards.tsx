'use client';

import { useState } from 'react';
import { onboardingAct } from '@/lib/api';
import { specLabel } from '@/lib/directions';
import { gradeLabel } from '@/lib/grades';
import type { ProfileDetails } from '@/server/claims/profile-details';
import { Button, Notice, Panel } from '../ui';
import styles from './Candidate.module.css';

const formats: Record<string, string> = { remote: 'удалённо', hybrid: 'гибрид', office: 'офис' };
const money = new Intl.NumberFormat('ru-RU');
export function ProfileBasics({ details, name }: { details: ProfileDetails | null; name: string }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = details?.basics;
  const rows = [
    { label: 'Стек', value: p?.stack.join(', '), source: 'анкета', step: 'stack' },
    { label: 'Грейд', value: details?.employerPreview.category ? `${gradeLabel(details.employerPreview.category.grade)} · подтверждён` : p?.claimedGrade ? `${gradeLabel(p.claimedGrade)} · заявлен, не подтверждён` : null, source: details?.employerPreview.category ? 'тест' : 'опрос', step: 'grade' },
    { label: 'Направление', value: details?.specialization ? specLabel(details.specialization) : null, source: 'опрос', step: 'specialization' },
    { label: 'Город', value: p?.city, source: 'опрос', step: 'city' },
    { label: 'Формат', value: p?.workFormats.map((f) => formats[f] ?? f).join(', '), source: 'опрос', step: 'formats' },
    { label: 'Ожидания', value: p?.salaryMin != null ? `${money.format(p.salaryMin)}${p.salaryExpected != null ? ` - ${money.format(p.salaryExpected)}` : ''} ₽` : null, source: 'опрос', step: 'salary' },
    { label: 'Контакты', value: details?.contact, source: 'скрыто от компаний', step: 'candidateContact' },
    { label: 'ФСП', value: details?.fspState === 'linked' ? 'Привязан, достижения в профиле' : details?.fspState === 'no_achievements' ? 'Привязан, достижений нет' : details?.fspState === 'unavailable' ? 'Привязан, реестр недоступен' : 'Не подключён', source: 'ФСП ID · симулятор', step: 'fsp' },
  ];
  async function edit(stepId: string) {
    setBusy(true); setError(null);
    try { await onboardingAct({ action: 'goto', stepId }); window.location.assign('/consultant?edit=profile'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось открыть редактирование'); setBusy(false); }
  }
  return <Panel className={styles.basicCard}>
    <div className={styles.sectionLabel}><span>Основное</span><Button size="sm" onClick={() => setEditing(!editing)}>{editing ? 'Готово' : 'Изменить'}</Button></div>
    <div className={styles.personIdentity}><span className={styles.personPortrait} aria-hidden="true"><svg viewBox="0 0 44 44"><circle cx="22" cy="16" r="8" /><path d="M6 44c1.5-10 8-15 16-15s14.5 5 16 15z" /></svg></span><div><h2>{name}</h2><p>{details?.specialization ? specLabel(details.specialization) : 'Направление не выбрано'}{p?.city ? ` · ${p.city}` : ''}</p></div></div>
    {error && <Notice tone="error">{error}</Notice>}
    <dl className={styles.basicFacts}>{rows.map((row) => <div key={row.label}><dt>{row.label}<span data-private={row.label === 'Контакты'} data-fsp={row.label === 'ФСП'}>{row.source}</span></dt><dd>{row.value || 'Не указано'}{editing && <button type="button" disabled={busy} onClick={() => void edit(row.step)}>Изменить ↗</button>}</dd></div>)}</dl>
  </Panel>;
}

export function ProfilePublicPreview({ details }: { details: ProfileDetails | null }) {
  const card = details?.employerPreview;
  return <Panel className={styles.basicCard}>
    <div className={styles.sectionLabel}>Так вас видит компания</div>
    <div className={styles.publicCard}>
      <div className={styles.personIdentity}><span className={styles.anonymousPortrait} aria-hidden="true"><svg viewBox="0 0 44 44"><circle cx="22" cy="16" r="8" /><path d="M6 44c1.5-10 8-15 16-15s14.5 5 16 15z" /></svg></span><div><h3>{card?.displayName ?? 'Анонимный кандидат'}</h3><p>{card?.category?.label ?? (card?.specialization ? `${specLabel(card.specialization)} · без категории` : 'Без категории')}</p></div></div>
      {card?.claims.length ? <div className={styles.skillTags}>{card.claims.map((claim) => <span key={claim.catalogId}>{claim.statement}</span>)}</div> : <p className={styles.meta}>Подтверждённых вами утверждений пока нет.</p>}
      {card?.fsp.hasAchievements && <p className={styles.meta}>Достижения ФСП · демоданные</p>}
      {details?.hiddenFromEmployers && <p className={styles.meta}>Сейчас профиль скрыт из поиска.</p>}
      <p className={styles.privacyFootnote}>Скрыто до принятия приглашения: имя, почта, контакт и цитаты из резюме.</p>
    </div>
    <Button href="/settings">Настроить, что видно →</Button>
  </Panel>;
}
