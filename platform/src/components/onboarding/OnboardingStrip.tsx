'use client';

import { useEffect, useState } from 'react';

import { Button } from '../ui';

import styles from './Onboarding.module.css';

const HIDDEN_KEY = 'fsp:onboarding-strip-hidden';

/**
 * Знакомство кандидата — таймлайн над чатом консультанта, а не отдельный экран (владелец 11.10:
 * «онбординг это то что показывается таймлайн над чатом и его можно скрыть / продолжить»).
 * Одна и та же полоска и когда вопрос открыт в ленте (`asking`), и когда идёт разговор:
 * «Продолжить» открывает следующий вопрос в этой же ленте, «Скрыть» закрывает вопрос и сворачивает таймлайн.
 */
export function OnboardingStrip({ done, total, asking, busy, onContinue, onHide }: { done: number; total: number; asking: boolean; busy?: boolean; onContinue: () => void; onHide: () => void }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(!asking && localStorage.getItem(HIDDEN_KEY) === '1');
    } catch {
      /* без хранилища — таймлайн развёрнут */
    }
  }, [asking]);
  const remember = (hidden: boolean) => {
    try {
      if (hidden) localStorage.setItem(HIDDEN_KEY, '1');
      else localStorage.removeItem(HIDDEN_KEY);
    } catch {
      /* только удобство */
    }
  };
  const hide = () => {
    remember(true);
    setCollapsed(true);
    if (asking) onHide();
  };
  const resume = () => {
    remember(false);
    setCollapsed(false);
    onContinue();
  };

  return (
    <header className={styles.top} data-testid="onboarding-strip" data-collapsed={collapsed || undefined}>
      <div className={styles.topRow}>
        <h1 className={styles.sceneTitle}>
          Карьерный консультант
          <span className={styles.title}>Знакомство · сохранено {done} из {total}</span>
        </h1>
        {!asking && (
          <Button size="sm" variant="primary" onClick={resume} disabled={busy} title="Следующий вопрос откроется здесь же, в ленте">
            Продолжить
          </Button>
        )}
        {collapsed ? (
          <Button size="sm" variant="ghost" onClick={() => { remember(false); setCollapsed(false); }}>
            Показать
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={hide} disabled={busy} title="Ответы сохранены - продолжишь с этого места">
            Скрыть
          </Button>
        )}
      </div>
      {!collapsed && (
        <div className={styles.segments} role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label={`Пройдено ${done} из ${total}`}>
          {Array.from({ length: total }, (_, i) => <i key={i} data-done={i < done || undefined} />)}
        </div>
      )}
    </header>
  );
}
