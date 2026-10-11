'use client';

import { useEffect, useState } from 'react';

import { Button } from '../ui';

import styles from './Onboarding.module.css';

const HIDDEN_KEY = 'fsp:onboarding-strip-hidden';

/**
 * Знакомство кандидата – таймлайн над чатом консультанта, а не отдельный экран (владелец 11.10:
 * «онбординг это то что показывается таймлайн над чатом и его можно скрыть / продолжить»).
 * «Скрыть» убирает полоску целиком (и закрывает открытый вопрос); вернуть её – выбрать продолжение
 * заполнения внизу («Дополнить профиль» в чате, «+ дополнить» в карточке): вопрос открывается (`asking`),
 * и полоска снова на месте (владелец 11.10: «по скрытию пропадать будет таймлайн и возвращаться, когда… нажму на вариант для продолжения»).
 */
export function OnboardingStrip({ done, total, asking, busy, canHide = true, onContinue, onHide }: { done: number; total: number; asking: boolean; busy?: boolean; canHide?: boolean; onContinue: () => void; onHide: () => void }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      // Открытый вопрос – это выбор «продолжить заполнение»: полоска возвращается и больше не помнит «скрыто».
      if (asking) localStorage.removeItem(HIDDEN_KEY);
      setHidden(canHide && !asking && localStorage.getItem(HIDDEN_KEY) === '1');
    } catch {
      setHidden(false);
    }
  }, [asking, canHide]);
  const hide = () => {
    try {
      localStorage.setItem(HIDDEN_KEY, '1');
    } catch {
      /* только удобство */
    }
    setHidden(true);
    if (asking) onHide();
  };

  if (hidden) return null;
  return (
    <header className={`${styles.top} ${styles.strip}`} data-testid="onboarding-strip">
      <div className={styles.topRow}>
        <h1 className={styles.sceneTitle}>
          Карьерный консультант
          <span className={styles.title}>Знакомство · пройдено {done} из {total} {total % 10 === 1 && total % 100 !== 11 ? 'вопроса' : 'вопросов'}</span>
        </h1>
        {!asking && (
          <Button size="sm" variant="primary" onClick={onContinue} disabled={busy} title="Следующий вопрос откроется здесь же, в ленте">
            Продолжить
          </Button>
        )}
        {canHide && <Button size="sm" variant="ghost" onClick={hide} disabled={busy} title="Ответы сохранены - вернуть таймлайн можно кнопкой «Дополнить профиль» внизу">
          Скрыть
        </Button>}
      </div>
      <div className={styles.segments} role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} aria-label={`Пройдено ${done} из ${total}`}>
        {Array.from({ length: total }, (_, i) => <i key={i} data-done={i < done || undefined} />)}
      </div>
    </header>
  );
}
