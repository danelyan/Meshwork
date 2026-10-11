'use client';

import type { CSSProperties } from 'react';

import type { IntroStages } from '@/server/consultant/stages';

import styles from './StageStrip.module.css';

const STATE_LABEL = { done: 'готово', now: 'сейчас', next: 'дальше' } as const;

/**
 * Полоса этапов знакомства над чатом консультанта (макет Astra v2): чёрная линия, квадратные номера,
 * «светлячок» в цвет роли бежит до текущего этапа, справа — «Заполнено X из N». Данные считает сервер
 * (server/consultant/stages.ts) и обновляет вместе с правой колонкой.
 */
export function StageStrip({ data }: { data: IntroStages }) {
  const n = data.items.length;
  const nowIdx = data.items.findIndex((s) => s.state === 'now');
  if (n === 0) return null;
  return (
    <section className={styles.strip} aria-label={data.title} data-testid="stage-strip">
      <div className={styles.top}>
        <h2 className={styles.title}>{data.title}</h2>
        <p className={styles.count} data-testid="stage-count">
          Заполнено <b>{data.done} из {data.total}</b>
        </p>
      </div>
      <div className={styles.track}>
        {nowIdx > 0 && <i className={styles.dot} aria-hidden="true" style={{ '--run-to': `${(nowIdx / n) * 100}%` } as CSSProperties} />}
        <ol className={styles.stages} style={{ '--stages': n } as CSSProperties}>
          {data.items.map((s, i) => (
            <li key={s.id} className={styles.stage} data-state={s.state} data-testid={`stage-${s.id}`} aria-current={s.state === 'now' ? 'step' : undefined}>
              <span className={styles.node} aria-hidden="true">
                {s.state === 'done' ? '✓' : i + 1}
              </span>
              <span className={styles.name}>{s.label}</span>
              <span className={styles.note}>{s.note}</span>
              <span className={styles.vh}> — {STATE_LABEL[s.state]}</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
