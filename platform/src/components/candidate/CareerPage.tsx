'use client';

import { useEffect, useState, type CSSProperties } from 'react';

import { getRecommendations, type RecommendationsView } from '@/lib/api';
import { getCareerVacancies } from '@/lib/career';
import { specLabel } from '@/lib/directions';
import { getFavorites, setFavorite } from '@/lib/favorites';
import type { TargetRec } from '@/server/recommend/types';
import type { CareerVacancy } from '@/server/recommend/career';

import { Button, Field, Kicker, Notice, Panel, Tag } from '../ui';
import ui from '../ui.module.css';
import styles from './Candidate.module.css';
import { SavedVacancies } from './SavedVacancies';

type Filters = { query: string; specialization: string; grade: string; salary: string; fit?: string };
const EMPTY: Filters = { query: '', specialization: '', grade: '', salary: '' };
const money = new Intl.NumberFormat('ru-RU');
export const coveragePercent = (target: TargetRec) => target.total > 0 ? Math.round(Math.min(1, target.covered / target.total) * 100) : 0;

export function filterTargets<T extends TargetRec>(targets: T[], filters: Filters): T[] {
  const query = filters.query.trim().toLocaleLowerCase('ru');
  return targets.filter((target) =>
    (!query || [target.companyName, target.title, specLabel(target.specialization), target.reason, ...target.missing.map((m) => m.statement), ...('stack' in target && Array.isArray(target.stack) ? target.stack : [])].join(' ').toLocaleLowerCase('ru').includes(query)) &&
    (!filters.specialization || target.specialization === filters.specialization) &&
    (!filters.grade || target.grade === filters.grade) &&
    (!filters.salary || target.salaryTo >= Number(filters.salary)) && (!filters.fit || coveragePercent(target) >= Number(filters.fit)),
  );
}

/** Real recommendation data; map distance visualizes coverage, never a geographic location. */
export function CareerPage({ savedOnly = false }: { savedOnly?: boolean }) {
  const [data, setData] = useState<RecommendationsView | null>(null);
  const [vacancies, setVacancies] = useState<CareerVacancy[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<'map' | 'list'>(savedOnly ? 'list' : 'map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [details, setDetails] = useState<RecommendationsView | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [moving, setMoving] = useState(true);
  const [revision, setRevision] = useState(0);
  const [onlySaved, setOnlySaved] = useState(false);

  useEffect(() => {
    let alive = true;
    setError(null);
    Promise.all([getCareerVacancies(savedOnly), getFavorites()]).then(async ([catalog, favorites]) => {
      const requested = new URLSearchParams(window.location.search).get('vacancy');
      let rows = catalog.targets;
      // A saved link can point beyond the first catalogue page. Resolve it from
      // the authenticated saved catalogue rather than opening an unrelated row.
      if (!savedOnly && requested && !rows.some((row) => row.vacancyId === requested) && favorites.kind === 'vacancy' && favorites.ids.includes(requested)) {
        const savedCatalog = await getCareerVacancies(true);
        const requestedRow = savedCatalog.targets.find((row) => row.vacancyId === requested);
        if (requestedRow) rows = [...rows, requestedRow];
      }
      if (!alive) return;
      setVacancies(rows);
      setTruncated(catalog.truncated);
      setData({});
      setSaved(favorites.kind === 'vacancy' ? favorites.ids : []);
      if (requested) setSelectedId(requested);
    }).catch((err: Error) => alive && setError(err.message));
    return () => { alive = false; };
  }, [revision, savedOnly]);

  const targets = vacancies;
  const filtered = filterTargets(savedOnly || onlySaved ? targets.filter((t) => saved.includes(t.vacancyId)) : targets, filters);
  const requestedMissing = Boolean(selectedId && !targets.some((t) => t.vacancyId === selectedId));
  const selected = requestedMissing ? undefined : filtered.find((t) => t.vacancyId === selectedId) ?? filtered[0];
  const mapTargets = filtered.slice(0, 18);
  if (selected && !mapTargets.includes(selected)) mapTargets[mapTargets.length - 1] = selected;
  const selectedVacancyId = selected?.vacancyId;
  useEffect(() => {
    let alive = true;
    setDetails(null);
    setDetailError(null);
    if (selectedVacancyId) getRecommendations(`vacancy:${selectedVacancyId}`).then(
      (value) => alive && setDetails(value),
      (err: Error) => alive && setDetailError(err.message),
    );
    return () => { alive = false; };
  }, [selectedVacancyId]);

  async function toggleSave(id: string) {
    setSaving(true);
    setStorageError(null);
    try {
      const result = await setFavorite('vacancy', id, !saved.includes(id));
      setSaved(result.ids);
    } catch (err) { setStorageError(err instanceof Error ? err.message : 'Не удалось сохранить избранное.'); }
    finally { setSaving(false); }
  }

  const filterCount = Object.values(filters).filter(Boolean).length;
  if (savedOnly && data && !error) return <SavedVacancies vacancies={filtered} saving={saving} error={storageError} onRemove={(id) => void toggleSave(id)} />;
  return <div className={styles.page}>
    <header className={styles.heading}>
      <h1>{savedOnly ? 'Избранное' : <>Найдите своё<br />место на карте</>}<i>.</i></h1>
      <p>{savedOnly ? 'Сохранённые вакансии вашего аккаунта. Вернитесь к интересным предложениям с любого устройства.' : 'Смотрите, каким вакансиям соответствует ваш опыт и какие навыки помогут приблизиться к цели.'}</p>
    </header>
    {error ? <Notice tone="error">{error} <Button size="sm" onClick={() => setRevision((n) => n + 1)}>Повторить</Button></Notice> : !data ? <p role="status">Загружаем вакансии…</p> : <>
      <form className={styles.search} onSubmit={(event) => { event.preventDefault(); setSelectedId(null); }}>
        <span className={styles.searchIcon} aria-hidden="true">⌕</span><input aria-label="Компания, роль или навык" placeholder="Компания, роль или навык" value={filters.query} onChange={(e) => setFilters({ ...filters, query: e.target.value })} />
        {filters.query && <button type="button" className={styles.clearSearch} onClick={() => setFilters({ ...filters, query: '' })}>Очистить</button>}
        <button className={styles.filterTrigger} type="button" aria-label="Фильтры" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 5h14M6 10h8M8 15h4" /></svg>{filterCount > 0 && <b>{filterCount}</b>}</button>
        <Button type="submit" variant="cta">Найти</Button>
      </form>
      {expanded && <Panel className={styles.filters}>
        <Field label="Направление"><select className={ui.input} value={filters.specialization} onChange={(e) => setFilters({ ...filters, specialization: e.target.value })}>
          <option value="">Все направления</option>{[...new Set(targets.map((t) => t.specialization))].map((spec) => <option key={spec} value={spec}>{specLabel(spec)}</option>)}
        </select></Field>
        <Field label="Грейд"><select className={ui.input} value={filters.grade} onChange={(e) => setFilters({ ...filters, grade: e.target.value })}><option value="">Любой грейд</option>{[...new Set(targets.map((t) => t.grade))].map((grade) => <option key={grade} value={grade}>{grade}</option>)}</select></Field>
        <Field label="Зарплата от, ₽"><input className={ui.input} type="number" min="0" step="10000" value={filters.salary} onChange={(e) => setFilters({ ...filters, salary: e.target.value })} /></Field>
        <Field label="Соответствие"><select className={ui.input} value={filters.fit ?? ''} onChange={(e) => setFilters({ ...filters, fit: e.target.value })}><option value="">Любое</option><option value="40">от 40%</option><option value="60">от 60%</option><option value="80">от 80%</option></select></Field>
        <Button onClick={() => setFilters(EMPTY)}>Сбросить всё</Button>
      </Panel>}
      {storageError && <Notice tone="error">{storageError}</Notice>}
      {requestedMissing && <Notice>Вакансия по ссылке недоступна в текущем каталоге. Возможно, она закрыта. <Button size="sm" onClick={() => setSelectedId(null)}>Выбрать другую вакансию</Button></Notice>}
      {truncated && <Notice>Показаны первые 200 активных вакансий. В избранном сохранённые предложения загружаются отдельно.</Notice>}
      <div className={styles.resultBar}><span role="status">Вакансий: {filtered.length}</span><Button size="sm" aria-pressed={onlySaved} onClick={() => setOnlySaved(!onlySaved)}>☆ Сохранённое</Button></div>
      {!filtered.length ? <Panel className={styles.empty}>
        <h2>{savedOnly && !filterCount ? 'Пока ничего не сохранено' : 'Подходящих вакансий пока нет'}</h2>
        <p>{filterCount ? 'Попробуйте другое название или сбросьте фильтры.' : savedOnly ? 'Добавьте вакансии в избранное из карты соответствия.' : 'Подтвердите карточки опыта у консультанта. Подбор учитывает реальные требования вакансий и утверждения вашего профиля.'}</p>
        <Button href={savedOnly ? '/career' : '/consultant'}>{savedOnly ? 'Открыть карту' : 'К консультанту'}</Button>{filterCount > 0 && <Button onClick={() => setFilters(EMPTY)}>Сбросить фильтры</Button>}
      </Panel> : <div className={styles.workspace}>
        <section className={styles.mapPanel} aria-label="Карта соответствия вакансиям">
          {mode === 'map' ? <>
            <div className={styles.mapCaption}><Kicker>Карта соответствия</Kicker><span>Ближе к центру = больше совпадений{filtered.length > 18 ? ' · На карте 18 вакансий, все доступны списком' : ''}</span></div>
            <div className={`${styles.mapViewport} ${moving ? '' : styles.paused}`}>
              <div className={styles.mapSurface} style={{ transform: `scale(${zoom})` }}>
                <svg viewBox="0 0 600 520" preserveAspectRatio="none" className={styles.connections} aria-hidden="true">
                  {[90, 150, 210].map((r) => <ellipse key={r} cx="300" cy="260" rx={r} ry={r * .9} className={styles.orbit} />)}
                  {mapTargets.map((target, i) => { const angle = i * 2.39996 - .8; const radius = 95 + (100 - coveragePercent(target)) * 1.25; return <path key={target.vacancyId} className={target.vacancyId === selected?.vacancyId ? styles.selectedConnection : styles.connection} d={`M300 260 Q${300 + Math.cos(angle + .5) * radius * .5} ${260 + Math.sin(angle + .5) * radius * .5} ${300 + Math.cos(angle) * radius} ${260 + Math.sin(angle) * radius * .9}`} />; })}
                </svg>
                <div className={styles.you}><svg viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="16" r="8" /><path d="M6 44c1.5-10 8-15 16-15s14.5 5 16 15z" /></svg><span>Вы</span></div>
                {mapTargets.map((target, i) => { const angle = i * 2.39996 - .8; const radius = 95 + (100 - coveragePercent(target)) * 1.25; return <button key={target.vacancyId} type="button" className={`${styles.node} ${target.vacancyId === selected?.vacancyId ? styles.selectedNode : ''}`} aria-pressed={target.vacancyId === selected?.vacancyId} onClick={() => setSelectedId(target.vacancyId)} style={{ left: `${50 + Math.cos(angle) * radius / 6}%`, top: `${50 + Math.sin(angle) * radius * .9 / 5.2}%`, '--delay': `${i * -.4}s` } as CSSProperties}>
                  <b>{target.companyName.slice(0, 1)}</b><span>{target.companyName}<small>{target.title}</small></span>
                </button>; })}
                {mapTargets.map((target, i) => { const angle = i * 2.39996 - .8; const radius = 95 + (100 - coveragePercent(target)) * 1.25; return <span key={target.vacancyId} className={styles.mapPercent} data-active={target.vacancyId === selected?.vacancyId} style={{ left: `${50 + Math.cos(angle) * radius / 12}%`, top: `${50 + Math.sin(angle) * radius * .9 / 10.4}%` }}>{coveragePercent(target)}%</span>; })}
              </div>
            </div>
          </> : <ul className={styles.vacancyList}>{filtered.map((target) => <li key={target.vacancyId}><button className={`${styles.vacancyRow} ${selected?.vacancyId === target.vacancyId ? styles.activeRow : ''}`} onClick={() => setSelectedId(target.vacancyId)} aria-pressed={selected?.vacancyId === target.vacancyId}><span className={styles.letter}>{target.companyName.slice(0, 1)}</span><span><b>{target.companyName}</b><span>{target.title}</span><small>{money.format(target.salaryFrom)}–{money.format(target.salaryTo)} ₽ · {specLabel(target.specialization)}</small></span><strong>{coveragePercent(target)}%</strong></button></li>)}</ul>}
          <div className={styles.mapControls}><div className={styles.viewSwitch} aria-label="Вид вакансий"><Button size="sm" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>Карта</Button><Button size="sm" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>Список</Button></div>{mode === 'map' && <><Button size="sm" aria-label="Уменьшить карту" disabled={zoom <= .8} onClick={() => setZoom((z) => Math.max(.8, z - .1))}>−</Button><Button size="sm" aria-label="Увеличить карту" disabled={zoom >= 1.5} onClick={() => setZoom((z) => Math.min(1.5, z + .1))}>+</Button><Button size="sm" aria-label="Приостановить анимацию" aria-pressed={!moving} onClick={() => setMoving(!moving)}>{moving ? 'Ⅱ' : '▶'}</Button><span className={styles.mapLegend}><i />Ваши связи</span></>}</div>
        </section>
        {selected && <Panel className={styles.detail} aria-label="Выбранная вакансия">
          <div className={styles.resultBar}><Kicker>Ваше соответствие</Kicker><Button size="sm" disabled={saving} aria-label={saved.includes(selected.vacancyId) ? 'Убрать из избранного' : 'Сохранить вакансию'} aria-pressed={saved.includes(selected.vacancyId)} onClick={() => void toggleSave(selected.vacancyId)}>{saved.includes(selected.vacancyId) ? '★' : '☆'}</Button></div>
          <div className={styles.selectedCompany}><span>{selected.companyName.slice(0, 1)}</span><div><h2>{selected.companyName}</h2><p>{selected.title}</p></div></div>
          <div className={styles.score}>{coveragePercent(selected)}<span>%</span><small>совпадение<br />по требованиям</small></div>
          <p className={styles.meta}>{money.format(selected.salaryFrom)}–{money.format(selected.salaryTo)} ₽ / месяц</p>
          <div className={styles.actions}><Tag>{specLabel(selected.specialization)}</Tag><Tag>{selected.grade}</Tag></div>
          {selected.description && <p>{selected.description}</p>}
          {selected.stack.length > 0 && <p className={styles.meta}>Стек: {selected.stack.join(', ')}</p>}
          {selected.teamDescription && <p className={styles.meta}>Команда: {selected.teamDescription}</p>}
          <p>{selected.reason}</p>
          {selected.matched.length > 0 && <div><h3>Что уже совпадает</h3><ul className={styles.requirements}>{selected.matched.map((item) => <li key={item.catalogId}>✓ {item.statement}<small className={styles.meta}> · {item.level === 'platform' ? 'проверено платформой' : item.level === 'third_party' ? 'внешний источник' : item.level === 'artifact' ? 'артефакт' : 'со слов'}</small></li>)}</ul></div>}
          <div><h3>Что усилить</h3>{selected.missing.length ? <ul className={styles.requirements}>{selected.missing.map((item) => <li key={item.catalogId}>{item.statement}</li>)}</ul> : <p>Все требования этой вакансии закрыты текущими утверждениями.</p>}</div>
          {detailError && <Notice tone="error">Не удалось загрузить рекомендации: {detailError}</Notice>}
          {details?.tasks?.length ? <div><h3>Как приблизиться к цели</h3><ul className={styles.requirements}>{details.tasks.map((task) => <li key={task.taskId}><span>{task.title}</span></li>)}</ul></div> : null}
          <details className={styles.vacancyDescription}><summary>Смотреть вакансию ↗</summary><h3>{selected.title}</h3><p>{selected.description || 'Компания пока не добавила описание.'}</p><p>{selected.teamDescription}</p><p>{selected.stack.join(', ')}</p></details>
          <Button loading={saving} onClick={() => void toggleSave(selected.vacancyId)}>{saved.includes(selected.vacancyId) ? 'Убрать из избранного' : 'Сохранить вакансию'}</Button>
          <p className={styles.fine}>Совпадение по требованиям, а не вероятность найма.</p>
        </Panel>}
      </div>}
      <Panel className={styles.nextStep}><div><Kicker>Следующий шаг</Kicker><p>{selected?.missing[0] ? `Подтяните: ${selected.missing[0].statement}. Это приблизит вас к выбранной вакансии.` : 'Подтвердите навыки и выберите следующий шаг вместе с консультантом.'}</p></div><Button href="/skills">Посмотреть требования ↗</Button></Panel>
    </>}
  </div>;
}
