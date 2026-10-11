'use client';

import { useState } from 'react';
import type { OnboardingView } from '@/server/onboarding/types';
import { Segmented } from '../ui';
import styles from './OnboardingDraft.module.css';

const candidateFields = [['goal', 'Цель'], ['documents', 'Документы'], ['fsp', 'ФСП ID'], ['specialization', 'Направление'], ['subcategory', 'Подкатегория'], ['grade', 'Предполагаемый грейд'], ['stack', 'Стек'], ['formats', 'Формат работы'], ['city', 'Город'], ['salary', 'Зарплата'], ['candidateContact', 'Контакт']];
const employerFields = [['companyName', 'Компания'], ['inn', 'ИНН'], ['industry', 'Отрасль'], ['about', 'О компании'], ['contact', 'Контакт'], ['needSpecialization', 'Направление'], ['needSubcategory', 'Подкатегория'], ['needGrades', 'Грейд'], ['needStack', 'Стек'], ['needTeam', 'Команда'], ['needSalary', 'Вилка']];
const publicFields = new Set(['specialization', 'subcategory', 'stack', 'formats', 'city', 'salary']);

export function fieldVisibility(id: string) {
  if (id === 'candidateContact') return 'после принятия приглашения';
  return publicFields.has(id) ? 'в анонимной карточке' : 'только тебе';
}

/** Only actual answers are shown. Never invents a confirmed grade or candidate ID. */
export function OnboardingDraft({ view, busy, onEdit }: { view: OnboardingView; busy: boolean; onEdit: (id: string) => void }) {
  const [company, setCompany] = useState(false);
  const employer = view.scenario === 'employer';
  const fields = employer ? employerFields : candidateFields;
  const answer = (id: string) => view.history.find((row) => row.stepId === id);
  const filled = view.history.filter((row) => row.answer !== null).length;
  return <section className={styles.draft}>
    <ViewTabs employer={employer} company={company} onChange={setCompany} />
    {company ? <CompanyPreview employer={employer} answer={(id) => answer(id)?.answer} /> : <div className={styles.card}>
      <header><small>ЧТО Я СОХРАНЯЮ</small><h2>Черновик профиля</h2><p>Ответы сохраняются по ходу разговора. Нажми на заполненное поле, чтобы изменить.</p><span>{filled} ответов сохранено</span></header>
      <div className={styles.rows}>{fields.map(([id, label]) => {
        const row = answer(id!);
        const current = view.current.id === id;
        const contents = <><span className={styles.rowTitle}>{label}<small>{employer ? 'черновик подбора' : fieldVisibility(id!)}</small></span><span className={styles.value}>{row?.answer ?? (row ? 'пропущено' : 'пока пусто')}</span>{current && <span className={styles.now}>заполняем сейчас</span>}</>;
        return row?.editable ? <button type="button" className={styles.row} data-current={current || undefined} key={id} disabled={busy} onClick={() => onEdit(id!)} aria-label={`Изменить: ${label}`}>{contents}</button> : <div className={styles.row} data-current={current || undefined} key={id}>{contents}</div>;
      })}</div>
      <footer><a href={view.consent.docUrl}>Согласие на обработку данных</a><span>Версия {view.consent.version}</span></footer>
    </div>}
  </section>;
}

/** «Как вижу я / Как видит компания» — общий переключатель черновика и карточки «Что я о тебе знаю». */
export function ViewTabs({ employer, company, onChange, compact = false }: { employer: boolean; company: boolean; onChange: (company: boolean) => void; compact?: boolean }) {
  // compact — узкая карточка «Что я о тебе знаю»: короткие подписи, полное название — в aria-label.
  const other = employer ? 'Как видит кандидат' : 'Как видит компания';
  return <Segmented label="Вид черновика" compact={compact} value={company ? 'company' : 'mine'} onChange={(v) => onChange(v === 'company')} options={[
    { value: 'mine', label: compact ? 'Мой вид' : 'Как вижу я', ariaLabel: 'Как вижу я' },
    { value: 'company', label: compact ? (employer ? 'Для кандидата' : 'Для компании') : other, ariaLabel: other },
  ]} />;
}

/** Предпросмотр для другой стороны: кандидату — анонимная карточка (только публичные поля), работодателю — компания. */
export function CompanyPreview({ employer, answer }: { employer: boolean; answer: (id: string) => string | null | undefined }) {
  const fields = employer ? employerFields : candidateFields;
  return <div className={`${styles.draft} ${styles.companyCard}`}>
    <small>ПРЕДПРОСМОТР · {employer ? 'КОМПАНИЯ' : 'АНОНИМНАЯ КАРТОЧКА'}</small>
    <div className={styles.identity}><span className={styles.silhouette} aria-hidden="true">◇</span><div><h2>{employer ? answer('companyName') || 'Компания' : 'Кандидат'}</h2><p>{answer(employer ? 'needSpecialization' : 'specialization') || 'Направление ещё не выбрано'}</p></div></div>
    <div className={styles.previewRows}>{fields.filter(([id]) => employer || publicFields.has(id!)).map(([id, label]) => <div key={id}><small>{label}</small><p>{answer(id!) || 'пока пусто'}</p></div>)}</div>
    <p className={styles.notice}>{employer ? 'Кандидат увидит информацию о компании и зарплатную вилку в приглашении.' : 'Имя и контакт откроются компании после принятия её приглашения. Предполагаемый грейд не является подтверждённым результатом оценки.'}</p>
  </div>;
}
