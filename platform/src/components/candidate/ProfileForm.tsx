'use client';

import { useState } from 'react';
import { onboardingAct, postJson } from '@/lib/api';
import { SPECIALIZATIONS, specLabel } from '@/lib/directions';
import { GRADES, gradeLabel } from '@/lib/grades';
import type { ProfileClaim } from '@/server/claims/types';
import type { ProfileDetails } from '@/server/claims/profile-details';
import { Notice, Panel } from '../ui';
import styles from './ProfileForm.module.css';

/** Отрасли – те же, что в шаге онбординга candidateIndustries (server/onboarding/scenario.ts). */
const INDUSTRIES = ['Финтех', 'E-commerce', 'Медиа', 'Госсектор', 'Промышленность', 'Образование', 'Медицина', 'Телеком'];
const FORMATS = [['remote', 'Удалённо'], ['hybrid', 'Гибрид'], ['office', 'Офис']] as const;
type Saver = (label: string, run: () => Promise<unknown>) => Promise<void>;

/** Значок источника навыка, как в макете: ● тест, ◐ GitHub, ○ со слов. */
function skillMark(skill: string, claims: ProfileClaim[]): '●' | '◐' | '○' {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'iu');
  const hits = claims.filter((c) => re.test(c.statement));
  if (hits.some((c) => c.level === 'platform')) return '●';
  if (hits.some((c) => c.sourceKind === 'github')) return '◐';
  return '○';
}

/**
 * Профиль кандидата формой, как в макете Astra v2 (кабинет, экран «Профиль»): Основное, Навыки, Условия.
 * Каждое поле сохраняется при выходе из него – тем же путём, что ответы Киры в онбординге и правки полей из резюме,
 * поэтому консультант и профиль видят одни данные. Категорию по-прежнему даёт только тест.
 */
export function ProfileForm({ details, name, claims, onSaved }: { details: ProfileDetails | null; name: string; claims: ProfileClaim[]; onSaved: () => Promise<void> }) {
  const p = details?.basics;
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newSkill, setNewSkill] = useState('');
  const stack = p?.stack ?? [];
  const formats = p?.workFormats ?? [];

  const save: Saver = async (label, run) => {
    setError(null); setStatus(`Сохраняю: ${label}…`);
    try { await run(); await onSaved(); setStatus(`Сохранено: ${label}`); }
    catch (e) { setStatus(null); setError(e instanceof Error ? e.message : 'Не удалось сохранить'); }
  };
  const answer = (stepId: string, value: unknown) => onboardingAct({ action: 'answer', stepId, value });
  const resume = (key: string, value: unknown) => postJson('/api/profile/resume-fields', { action: 'set', key, value });
  const setStack = (next: string[]) => save('навыки', () => answer('stack', next));
  const setFormats = (next: string[]) => save('формат', () => answer('formats', next));
  const blurText = (current: string, label: string, run: (v: string) => Promise<unknown>) => (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const v = e.currentTarget.value.trim();
    if (v && v !== current) void save(label, () => run(v));
  };
  const salaryFrom = p?.salaryMin != null ? Math.round(p.salaryMin / 1000) : null;
  const salaryTo = p?.salaryExpected != null ? Math.round(p.salaryExpected / 1000) : null;
  const saveSalary = (from: number | null, to: number | null) => {
    if (from == null || to == null || Number.isNaN(from) || Number.isNaN(to)) return;
    if (from === salaryFrom && to === salaryTo) return;
    void save('зарплата', () => answer('salary', { from, to }));
  };
  const roleValue = p?.roles?.[0] ?? '';

  return <>
    <Panel className={styles.card}>
      <h2 className={styles.title}>Основное</h2>
      <div className={styles.grid}>
        <label className={styles.field}><span>ФИО</span><input key={`n-${name}`} defaultValue={name} onBlur={blurText(name, 'ФИО', (v) => resume('name', v))} /></label>
        <label className={styles.field}><span>Желаемая роль</span><input key={`r-${roleValue}`} defaultValue={roleValue} placeholder="Например, Backend-разработчик (Go)" onBlur={blurText(roleValue, 'желаемая роль', (v) => resume('roles', [v, ...(p?.roles ?? []).filter((r) => r !== v && r !== roleValue)]))} /></label>
        <label className={styles.field}><span>Город</span><input key={`c-${p?.city ?? ''}`} defaultValue={p?.city ?? ''} placeholder="Например, Новосибирск" onBlur={blurText(p?.city ?? '', 'город', (v) => answer('city', v))} /></label>
        <label className={styles.field}><span>Специализация</span><select value={details?.specialization ?? ''} onChange={(e) => void save('специализация', () => answer('specialization', e.target.value))}><option value="" disabled>Выберите</option>{SPECIALIZATIONS.map((s) => <option key={s} value={s}>{specLabel(s)}</option>)}</select></label>
        <label className={styles.field}><span>Отрасль</span><select value={details?.industries?.[0] ?? ''} onChange={(e) => void save('отрасль', () => answer('candidateIndustries', [e.target.value, ...(details?.industries ?? []).slice(1).filter((i) => i !== e.target.value)]))}><option value="">ИТ, разработка</option>{INDUSTRIES.map((i) => <option key={i} value={i}>{i}</option>)}</select></label>
        <label className={styles.field}><span>Предполагаемый грейд</span><select value={p?.claimedGrade ?? ''} onChange={(e) => void save('грейд', () => answer('grade', e.target.value))}><option value="" disabled>Выберите</option>{GRADES.map((g) => <option key={g} value={g}>{gradeLabel(g)}</option>)}</select><small>выбираете сами, подтверждает тест</small></label>
        <label className={`${styles.field} ${styles.wide}`}><span>О себе</span><textarea key={`a-${details?.about ?? ''}`} rows={3} maxLength={1000} defaultValue={details?.about ?? ''} placeholder="2-3 предложения: чем занимаетесь и что ищете" onBlur={blurText(details?.about ?? '', 'о себе', (v) => answer('experienceSummary', v))} /></label>
      </div>
    </Panel>

    <Panel className={styles.card}>
      <div className={styles.head}><h2 className={styles.title}>Навыки</h2><span className={styles.legend}><i>●</i> тест <i>◐</i> GitHub <i>○</i> со слов</span></div>
      <div className={styles.chips}>
        {stack.map((s) => <span key={s} className={styles.chip}><i aria-label={{ '●': 'подтверждено тестом', '◐': 'есть в GitHub', '○': 'со слов' }[skillMark(s, claims)]}>{skillMark(s, claims)}</i>{s}<button type="button" aria-label={`Убрать ${s}`} onClick={() => void setStack(stack.filter((x) => x !== s))}>×</button></span>)}
        <form className={styles.addSkill} onSubmit={(e) => { e.preventDefault(); const v = newSkill.trim(); if (v && !stack.some((s) => s.toLowerCase() === v.toLowerCase())) { setNewSkill(''); void setStack([...stack, v]); } }}>
          <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)} placeholder="Добавить навык" aria-label="Добавить навык" />
        </form>
      </div>
      {details?.suggestions && details.suggestions.length > 0 && <div className={styles.suggest}><span>Нашли у вас:</span>{details.suggestions.map((g) => <button key={g.name} type="button" onClick={() => void setStack([...stack, g.name])}>+ {g.name} <small>{g.from === 'github' ? 'GitHub' : 'резюме'}</small></button>)}</div>}
    </Panel>

    <Panel className={styles.card}>
      <h2 className={styles.title}>Условия</h2>
      <div className={styles.grid3}>
        <label className={styles.field}><span>Опыт, лет</span><input key={`y-${p?.experienceYears ?? ''}`} type="number" min={0} max={60} defaultValue={p?.experienceYears ?? ''} onBlur={(e) => { const v = e.currentTarget.value; const n = v === '' ? null : Number(v); if (n !== (p?.experienceYears ?? null)) void save('опыт', () => resume('experienceYears', n)); }} /></label>
        <label className={styles.field}><span>Зарплата от, ₽</span><input key={`f-${salaryFrom}`} type="number" min={40} max={600} step={10} defaultValue={salaryFrom ?? ''} placeholder="тыс ₽" onBlur={(e) => saveSalary(Number(e.currentTarget.value), salaryTo ?? Number(e.currentTarget.value))} /><small>тыс ₽ в месяц</small></label>
        <label className={styles.field}><span>до, ₽</span><input key={`t-${salaryTo}`} type="number" min={40} max={600} step={10} defaultValue={salaryTo ?? ''} placeholder="тыс ₽" onBlur={(e) => saveSalary(salaryFrom ?? Number(e.currentTarget.value), Number(e.currentTarget.value))} /><small>тыс ₽ в месяц</small></label>
      </div>
      <div className={styles.formats}>
        {FORMATS.map(([value, label]) => <button key={value} type="button" aria-pressed={formats.includes(value)} onClick={() => void setFormats(formats.includes(value) ? formats.filter((f) => f !== value) : [...formats, value])}>{label}</button>)}
        <label className={styles.check}><input type="checkbox" checked={formats.includes('relocation')} onChange={() => void setFormats(formats.includes('relocation') ? formats.filter((f) => f !== 'relocation') : [...formats, 'relocation'])} />Готов к переезду</label>
      </div>
    </Panel>
    <p className={styles.autosave} role="status">{status ?? 'Изменения сохраняются автоматически'}</p>
    {error && <Notice tone="error">{error}</Notice>}
  </>;
}
