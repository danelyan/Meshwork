'use client';

import { useState, type ReactNode } from 'react';

import { Container } from '@/components/shell/Container';

import { BlindEvaluate } from './BlindEvaluate';
import styles from './BlindEvaluate.module.css';

type Mode = 'blind' | 'json';

/** Переключатель режимов /evaluate: «Разметить самому» (по умолчанию) и «Загрузить JSON» (children). */
export function EvaluateModes({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>('blind');
  return (
    <>
      <Container size="default">
        <div className={styles.tabs} role="tablist" aria-label="Режим проверки">
          <button type="button" role="tab" aria-selected={mode === 'blind'} className={styles.tab} onClick={() => setMode('blind')}>
            Разметить самому
          </button>
          <button type="button" role="tab" aria-selected={mode === 'json'} className={styles.tab} onClick={() => setMode('json')}>
            Загрузить JSON
          </button>
        </div>
      </Container>
      {mode === 'blind' ? <BlindEvaluate /> : children}
    </>
  );
}
