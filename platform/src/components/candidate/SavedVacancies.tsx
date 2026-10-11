'use client';

import { useState, type CSSProperties } from 'react';
import { companyDisplayName } from '@/lib/company-brand';
import { CompanyLogo } from '@/components/landing/CompanyLogo';
import { chooseGapCta, type GapCategory } from '@/lib/career-gap';
import type { CareerVacancy } from '@/server/recommend/career';
import { Button, Notice, Panel } from '../ui';
import styles from './Candidate.module.css';
const money = new Intl.NumberFormat('ru-RU');
const coveragePercent = (vacancy: CareerVacancy) => vacancy.total > 0 ? Math.round(Math.min(1, vacancy.covered / vacancy.total) * 100) : 0;

export function SavedVacancies({ vacancies, categories, saving, error, onRemove }: { vacancies: CareerVacancy[]; categories: GapCategory[]; saving: boolean; error: string | null; onRemove: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [moving, setMoving] = useState(true);
  const selected = vacancies.find((vacancy) => vacancy.vacancyId === selectedId) ?? vacancies[0];
  const nodes = vacancies.slice(0, 18);
  if (selected && !nodes.includes(selected)) nodes[nodes.length - 1] = selected;
  const position = (vacancy: CareerVacancy, index: number) => {
    const angle = index * 2.39996 - .8;
    const radius = 100 + (100 - coveragePercent(vacancy)) * 1.35;
    return { x: 380 + Math.cos(angle) * radius, y: 280 + Math.sin(angle) * radius * .85 };
  };
  return <div className={styles.page}>
    <header className={styles.savedHeading}><div className={styles.heading}><h1>Избранное<i>.</i></h1><p>Сохранённые вакансии и ваше соответствие каждой. Вернитесь к ним с любого устройства. Ближе к центру - больше совпадений.</p></div><span className={styles.meta} role="status">Вакансий: {vacancies.length}</span></header>
    {error && <Notice tone="error">{error}</Notice>}
    {selected ? <>
      <div className={styles.savedWorkspace}>
        <section className={styles.mapPanel} aria-label="Карта избранных вакансий">
          <div className={styles.mapCaption}><span>Карта соответствия</span><span>Совпадение требований, а не вероятность найма{vacancies.length > 18 ? ' · На карте 18 вакансий, все доступны списком ниже' : ''}</span></div>
          <div className={`${styles.savedViewport} ${moving ? '' : styles.paused}`}>
            <div className={styles.savedScrollArea} style={{ width: 760 * zoom, height: 560 * zoom }}><div className={styles.savedSurface} style={{ transform: `scale(${zoom})` }}>
              <svg viewBox="0 0 760 560" className={styles.connections} aria-hidden="true">{[110, 185, 265].map((radius) => <ellipse key={radius} cx="380" cy="280" rx={radius} ry={radius * .85} className={styles.orbit} />)}{nodes.map((vacancy, index) => { const { x, y } = position(vacancy, index); return <path key={vacancy.vacancyId} d={`M380 280L${x} ${y}`} className={selected.vacancyId === vacancy.vacancyId ? styles.selectedConnection : styles.connection} />; })}</svg>
              <div className={styles.you}><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="16" r="8" /><path d="M6 44c1.5-10 8-15 16-15s14.5 5 16 15z" /></svg><span>Вы</span></div>
              {nodes.map((vacancy, index) => { const { x, y } = position(vacancy, index); return <button key={vacancy.vacancyId} className={`${styles.node} ${styles.savedNode} ${selected.vacancyId === vacancy.vacancyId ? styles.selectedNode : ''}`} aria-pressed={selected.vacancyId === vacancy.vacancyId} onClick={() => setSelectedId(vacancy.vacancyId)} style={{ left: `${x / 7.6}%`, top: `${y / 5.6}%`, '--delay': `${index * -.4}s` } as CSSProperties}><b><CompanyLogo company={{ name: vacancy.companyName }} /></b><span>{companyDisplayName(vacancy.companyName)}<small>{vacancy.title}</small></span><strong>{coveragePercent(vacancy)}%</strong></button>; })}
            </div></div>
          </div>
          <div className={styles.mapControls}><Button size="sm" aria-label="Уменьшить карту" disabled={zoom <= .8} onClick={() => setZoom(Math.max(.8, zoom - .1))}>−</Button><Button size="sm" aria-label="Увеличить карту" disabled={zoom >= 1.5} onClick={() => setZoom(Math.min(1.5, zoom + .1))}>+</Button><Button size="sm" aria-label="Приостановить анимацию" aria-pressed={!moving} onClick={() => setMoving(!moving)}>{moving ? 'Ⅱ' : '▶'}</Button><span className={styles.mapLegend}><i />Ваши связи</span></div>
        </section>
        <Panel className={`${styles.detail} ${styles.savedDetail}`} aria-label="Выбранная сохранённая вакансия">
          <div className={styles.selectedCompany}><span>{selected.companyName.slice(0, 1)}</span><div><h2>{selected.companyName}</h2><p>{selected.title}</p></div><Button className={styles.savedRemove} aria-label={`Убрать из избранного: ${selected.companyName}`} disabled={saving} onClick={() => onRemove(selected.vacancyId)}>★</Button></div>
          <div className={styles.savedScore}><b>{coveragePercent(selected)}%</b><span>совпадение<br />с требованиями</span></div>
          <p>{money.format(selected.salaryFrom)} - {money.format(selected.salaryTo)} ₽ / месяц</p>
          <p className={styles.meta}>Указано {selected.covered} из {selected.total} требований. {selected.reason}</p>
          <div><h3>Уже совпадает</h3>{selected.matched.length ? <ul className={styles.requirements}>{selected.matched.map((item) => <li key={item.catalogId}>✓ {item.statement}</li>)}</ul> : <p>Совпадений пока нет.</p>}</div>
          <div><h3>Что подтянуть</h3>{selected.missing.length ? <ul className={`${styles.requirements} ${styles.missingRequirements}`}>{selected.missing.map((item) => <li key={item.catalogId}>{item.statement}</li>)}</ul> : <p>Все требования вакансии закрыты текущими утверждениями.</p>}</div>
          {(() => { const cta = chooseGapCta(selected, categories); return <div className={styles.gapCta}>{cta.href ? <Button variant="cta" href={cta.href}>{cta.label}</Button> : <Notice>{cta.label}</Notice>}<small className={styles.fine}>{cta.hint}</small></div>; })()}
          <Button href={`/career?vacancy=${encodeURIComponent(selected.vacancyId)}`}>Смотреть вакансию ↗</Button>
          <p className={styles.fine}>Сохранение не открывает компании ваше имя и контакт.</p>
        </Panel>
      </div>
      <Panel className={styles.savedListPanel}><h2>Все сохранённые вакансии</h2><ul className={styles.vacancyList}>{vacancies.map((vacancy) => <li key={vacancy.vacancyId}><button className={`${styles.vacancyRow} ${selected.vacancyId === vacancy.vacancyId ? styles.activeRow : ''}`} aria-pressed={selected.vacancyId === vacancy.vacancyId} onClick={() => setSelectedId(vacancy.vacancyId)}><span className={styles.letter}><CompanyLogo company={{ name: vacancy.companyName }} /></span><span><b>{companyDisplayName(vacancy.companyName)}</b><span>{vacancy.title}</span><small>{money.format(vacancy.salaryFrom)} - {money.format(vacancy.salaryTo)} ₽</small></span><strong>{coveragePercent(vacancy)}%</strong></button></li>)}</ul></Panel>
    </> : <div className={styles.savedEmpty}>Пока пусто. Сохраняйте вакансии кнопкой ☆ в панели справа на карте.<Button href="/career">Перейти на карту →</Button></div>}
  </div>;
}
