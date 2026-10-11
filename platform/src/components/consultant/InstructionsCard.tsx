'use client';

import { useId, useState } from 'react';

import { CUSTOM_MAX, SKILLS, type ConsultantSettingsData } from '@/server/consultant/skills';

import styles from './InstructionsCard.module.css';

type Status = 'idle' | 'saving' | 'saved' | 'error';

/**
 * «Как мне работать»: кандидат включает готовые режимы консультанта и пишет свои инструкции (до 500 символов).
 * Сохраняет PUT /api/consultant/settings. Меняется только стиль и фокус ответов консультанта – не подборка и не тест.
 * Начальные данные – из колонки (SceneAsideData.instructions); дальше состояние своё, обновление колонки его не сбрасывает.
 */
export function InstructionsCard({ initial }: { initial?: ConsultantSettingsData }) {
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [custom, setCustom] = useState(initial?.custom ?? '');
  const [status, setStatus] = useState<Status>('idle');
  const fieldId = useId();
  const counterId = useId();

  const toggle = (id: string) => {
    setSkills((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
    setStatus('idle');
  };

  const save = async () => {
    setStatus('saving');
    try {
      const res = await fetch('/api/consultant/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skills, custom }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const saved = (await res.json()) as ConsultantSettingsData;
      setSkills(saved.skills);
      setCustom(saved.custom);
      setStatus('saved');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className={styles.wrap} data-testid="instructions-card">
      <p className={styles.lead}>Меняет только то, как консультант с тобой говорит. На подборку, категорию и тест не влияет.</p>
      <ul className={styles.chips} aria-label="Режимы консультанта">
        {SKILLS.map((s) => {
          const on = skills.includes(s.id);
          return (
            <li key={s.id}>
              <button type="button" className={styles.chip} aria-pressed={on} title={s.description} onClick={() => toggle(s.id)}>
                {s.label}
              </button>
            </li>
          );
        })}
      </ul>
      <label className={styles.label} htmlFor={fieldId}>
        Свои инструкции
      </label>
      <textarea
        id={fieldId}
        className={styles.field}
        rows={3}
        maxLength={CUSTOM_MAX}
        value={custom}
        aria-describedby={counterId}
        placeholder="Например: обращайся на «вы», примеры на Go"
        onChange={(e) => {
          setCustom(e.target.value.slice(0, CUSTOM_MAX));
          setStatus('idle');
        }}
      />
      <div className={styles.row}>
        <span id={counterId} className={styles.counter}>
          {custom.length}/{CUSTOM_MAX}
        </span>
        <span className={styles.status} role="status" aria-live="polite">
          {status === 'saved' ? 'сохранено' : status === 'error' ? 'не сохранилось, попробуй ещё раз' : ''}
        </span>
        <button type="button" className={styles.save} onClick={save} disabled={status === 'saving'}>
          {status === 'saving' ? 'Сохраняю…' : 'Сохранить'}
        </button>
      </div>
    </div>
  );
}
