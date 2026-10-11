'use client';

import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Button, Panel } from '@/components/ui';
import type { EvidenceLevel } from '@/server/claims/types';
import styles from './LandingSections.module.css';

const LEVELS: { id: EvidenceLevel; sign: string; name: string; source: string; proof: string; fill: string }[] = [
  { id: 'self_reported', sign: '○', name: 'Со слов', source: 'резюме', proof: '«Писал сервисы на FastAPI» - так написано в резюме.', fill: '25%' },
  { id: 'artifact', sign: '◐', name: 'Есть в проекте', source: 'GitHub-репозиторий', proof: 'В репозитории API, тесты и обработка ошибок.', fill: '50%' },
  { id: 'third_party', sign: '◑', name: 'Третья сторона', source: 'нет', proof: 'Подтверждения от ФСП или ментора пока нет.', fill: '0%' },
  { id: 'platform', sign: '●', name: 'Проверено платформой', source: 'тест и защита', proof: 'Задачи по Python решены в тесте, код проекта объяснён на защите.', fill: '100%' },
];
const STEPS = [
  ['Профиль', 'Резюме или ссылки. Кира найдёт навыки.', 'Начни с материалов'],
  ['Тест', 'Адаптивный тест даёт категорию.', 'Подтверди уровень'],
  ['Созвон', 'Объясни свои решения.', 'По желанию'],
  ['Проект', 'Автопроверка и защита.', 'По желанию'],
  ['Предложение', 'Вилка сразу. Контакты после «да».', 'Когда придёт'],
] as const;
const CANDIDATE_ITEMS = [
  ['Разбирает материалы', 'Резюме, документы и ссылки на проекты.', 'file'],
  ['Находит доказательства', 'Предлагает факты с цитатами и источниками.', 'search'],
  ['Помогает развиваться', 'Объясняет результаты теста и пробелы к цели.', 'chart'],
  ['Разбирает приглашения', 'Помогает понять требования и условия.', 'mail'],
] as const;
const EMPLOYER_ITEMS = [
  ['Собирает подборку', 'Опиши задачу словами, Кира уточнит требования.', 'star'],
  ['Объясняет выбор', 'Что подтверждено, что закрыто, что проверить.', 'list'],
  ['Условия приглашения', 'Поможет оформить вилку и условия.', 'salary'],
  ['Готовит приглашение', 'Черновик с условиями, отправляешь ты.', 'send'],
] as const;
const PATHS: Record<string, string> = {
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  check: 'M4 4h16v16H4z M8.5 12.5l2.5 2.5 4.5-5.5',
  file: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6',
  search: 'M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M20 20l-4.5-4.5 M8.5 11l2 2 3.5-3.5',
  chart: 'M4 19h16 M6 15l4-4 3 3 5-6 M15 8h3v3',
  mail: 'M3 5h18v14H3z M3 6l9 7 9-7',
  star: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  list: 'M8 6h13 M8 12h13 M8 18h13 M3 6l1 1 2-2 M3 12l1 1 2-2 M3 18l1 1 2-2',
  salary: 'M8 20V4h6a4 4 0 0 1 0 8H6 M6 16h8',
  send: 'M3 11l18-8-8 18-2-8z',
  card: 'M3 4h18v16H3z M3 9h18 M8 14h4 M8 17h7',
  code: 'M8 6l-5 6 5 6 M16 6l5 6-5 6 M14 4l-4 16',
};
function Icon({ name, large = false }: { name: string; large?: boolean }) {
  return <span className={`${styles.icon} ${large ? styles.largeIcon : ''}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={PATHS[name]} /></svg></span>;
}
function Title({ children }: { children: ReactNode }) {
  return <h2 className={styles.title}>{children}<i>.</i></h2>;
}
function FeatureList({ items }: { items: readonly (readonly [string, string, string])[] }) {
  return <ul className={styles.features}>{items.map(([title, description, icon]) => <li key={title}><Icon name={icon} /><span><b>{title}</b><span>{description}</span></span></li>)}</ul>;
}
function DialogExample({ employer = false }: { employer?: boolean }) {
  return <div className={styles.dialog} aria-label={`Пример разговора ${employer ? 'работодателя' : 'специалиста'} с Кирой`}><div className={styles.userMessage}>{employer ? 'Нужен Backend Middle: REST API, PostgreSQL, желательно Kafka.' : 'Что мне стоит подтвердить для Backend Middle?'}</div><div className={styles.reply}><span className={styles.kiraMark} aria-hidden="true">✦</span><div><b>Кира</b>{employer ? 'Подобрала кандидатов. У каждого покажу, какие требования подтверждены и что стоит проверить.' : 'Начнём с твоего опыта и проектов. Покажу, какие навыки уже подкреплены источниками, и предложу следующий шаг.'}</div></div></div>;
}
function ExampleBadge({ level }: { level: EvidenceLevel }) {
  const value = LEVELS.find(item => item.id === level)!;
  return <span className={styles.badge} data-level={level}><span aria-hidden="true">{value.sign}</span> {value.name}</span>;
}

/** Four sections ported from the owner's landing-astra export. Examples stay local to this page. */
export function LandingSections({ signedIn }: { signedIn: boolean }) {
  const [selected, setSelected] = useState<EvidenceLevel>('platform');
  const current = LEVELS.find(level => level.id === selected)!;
  return <>
    <section id="proof" className={`${styles.section} ${styles.split}`} aria-labelledby="proof-title">
      <div><h2 id="proof-title" className={styles.title}>За каждым навыком есть доказательство<i>.</i></h2><p className={styles.lead}>Резюме рассказывает об опыте. Профиль показывает, на чём основан каждый навык.</p><ul className={styles.proofFeatures}>{([
        ['Источник у каждого навыка', 'Резюме, репозиторий, демореестр ФСП или проверка на платформе.', 'link'],
        ['Видно, что проверено', 'Работодатель отличает «написал в резюме» от «решил на платформе».', 'eye'],
        ['Решаешь ты', 'Кира предлагает факты, ты выбираешь, что сохранить.', 'check'],
      ] as const).map(([title, description, icon], index) => <li key={title} style={{ '--delay': `${index * 0.6}s` } as CSSProperties}><Icon name={icon} large /><span><b>{title}</b><span>{description}</span></span></li>)}</ul></div>
      <Panel className={styles.proofPanel}><div className={styles.skillHeader}><span className={styles.kicker}>Навык</span><b>[ Python · Backend ]</b></div><div className={styles.levels} role="group" aria-label="Уровни доказанности примера навыка">{LEVELS.map((level, index) => <Button className={styles.level} key={level.id} aria-pressed={selected === level.id} aria-controls="landing-proof-detail" onClick={() => setSelected(level.id)} data-level={level.id}><span className={styles.levelName}><span aria-hidden="true">{level.sign}</span>{level.name}</span><span className={styles.bar} aria-hidden="true"><i style={{ width: level.fill, animationDelay: `${0.2 + index * 0.18}s` }} /></span><span className={styles.source}>{level.source}</span></Button>)}</div><div id="landing-proof-detail" className={styles.proofDetail} aria-live="polite"><span className={styles.kicker}>{current.name} · {current.source}</span><p>{current.proof}</p></div><p className={styles.note}>Пример: навык есть в проекте и подтверждён на платформе. Реестра ФСП нет - и это нормально.</p></Panel>
    </section>
    <section id="path" className={styles.section} aria-label="Путь кандидата"><Title>От первого разговора до предложения</Title><div className={styles.route}><i className={styles.routeRunner} aria-hidden="true" /><ol>{STEPS.map(([name, description, label], index) => <li key={name} data-optional={index === 2 || index === 3 ? 'true' : undefined}><span className={styles.stepNumber}>{index + 1}</span><span className={styles.stepLabel}>{label}</span><h3>{name}</h3><p>{description}</p></li>)}</ol></div><p className={styles.routeNote}>Пунктир - по желанию. Приглашение может прийти раньше.</p></section>
    <section id="kira" className={styles.section} aria-label="Кира"><Title>ИИ поможет обеим сторонам</Title><p className={styles.lead}>ИИ-консультант Кира разбирает материалы и объясняет следующий шаг. Она предлагает, решение остаётся за человеком.</p><div className={styles.kiraGrid}><Panel className={styles.kiraPanel}><h3 className={styles.roleTitle}>Специалисту</h3><FeatureList items={CANDIDATE_ITEMS} /><DialogExample /></Panel><Panel className={`${styles.kiraPanel} ${styles.employer}`}><h3 className={styles.roleTitle}>Работодателю</h3><FeatureList items={EMPLOYER_ITEMS} /><DialogExample employer /></Panel></div></section>
    <section id="employer" className={`${styles.section} ${styles.employer}`} aria-label="Работодателю"><div className={`${styles.split} ${styles.employerSplit}`}><div><p className={styles.roleTitle}>Работодателю</p><Title>Ищи под задачу. Выбирай по доказательствам</Title><p className={styles.lead}>Опиши вакансию, стек и требования. Получи подборку кандидатов и объяснение: что подтверждено, какие требования закрыты и что ещё стоит проверить.</p><ul className={styles.employerFeatures}>{([
      ['Понятная карточка', 'Категория, навыки и результаты проверок в одной карточке.', 'card'],
      ['Практическая оценка', 'Проектное задание и защита помогают увидеть подход к работе.', 'code'],
      ['Прямое приглашение', 'Укажи условия и зарплатную вилку, кандидат сам решит, принимать ли предложение.', 'send'],
    ] as const).map(([title, description, icon]) => <li key={title}><Icon name={icon} /><b>{title}</b><p>{description}</p></li>)}</ul><Button href={signedIn ? '/employer/assistant' : '/auth?next=%2Femployer%2Fassistant'} className={styles.employerCta}>Я работодатель <svg viewBox="0 0 56 32" aria-hidden="true"><polygon points="0,13.5 44,13.5 33,3 36.5,0 56,16 36.5,32 33,29 44,18.5 0,18.5" fill="currentColor" /></svg></Button></div><Panel className={styles.matchPanel}><p className={styles.kicker}>Почему в подборке</p><div className={styles.candidateCard}><div className={styles.candidateHeader}><b>Кандидат · Backend Middle</b><small>псевдоним до «да»</small></div>{([
      ['REST API', '✓ закрыто', 'platform'], ['PostgreSQL', '✓ закрыто', 'artifact'], ['Kafka', 'стоит проверить', 'self_reported'],
    ] as const).map(([skill, status, level]) => <div className={styles.matchRow} key={skill}><b>{skill}</b><span>{status}</span><div><ExampleBadge level={level} /></div></div>)}</div><p className={styles.note}>Демонстрационный пример подборки.</p></Panel></div></section>
  </>;
}
