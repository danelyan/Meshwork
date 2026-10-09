'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type OnboardingAction, completeOnboarding, onboardingAct, onboardingLater } from '@/lib/api';
import type { OnboardingView } from '@/server/onboarding/types';

import { Button, Kicker, Meter, Notice } from '../ui';

import styles from './Onboarding.module.css';
import { StepInput } from './StepInput';
import { Summary } from './Summary';

export interface OnboardingChatProps {
  initial: OnboardingView;
  /** Абзацы текста согласия (server/onboarding/consent-text.ts). */
  consentText: string[];
}

/**
 * Онбординг-чат на весь экран: минимальная шапка (знак, прогресс, «Настроить позже»),
 * лента прошлых вопросов и ответов, текущий вопрос с вариантами-кнопками.
 * Вся логика шагов — на сервере; клиент только показывает OnboardingView и шлёт действия.
 */
export function OnboardingChat({ initial, consentText }: OnboardingChatProps) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    currentRef.current?.focus({ preventScroll: true });
  }, [view.current.id]);

  const act = useCallback(async (body: OnboardingAction) => {
    setBusy(true);
    setError(null);
    try {
      setView(await onboardingAct(body));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось. Повторите.');
    } finally {
      setBusy(false);
    }
  }, []);

  const go = useCallback(
    (path: string) => {
      router.push(path);
      router.refresh();
    },
    [router],
  );

  async function later() {
    setBusy(true);
    setError(null);
    try {
      go((await onboardingLater()).next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось. Повторите.');
      setBusy(false);
    }
  }

  async function finish(target?: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await completeOnboarding();
      go(target ?? r.next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось завершить. Повторите.');
      setBusy(false);
    }
  }

  const cur = view.current;
  const { done, total } = view.progress;
  const isSummary = cur.kind === 'summary';

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className={styles.mark} src="/assets/fsp-mark.svg" alt="ФСП Карьера" />
        <div className={styles.progress}>
          <Meter value={done} max={total} label={`Пройдено ${done} из ${total}`} className={styles.meter} />
          <span className={styles.count} aria-hidden="true">
            {isSummary ? 'готово' : `${Math.min(done + 1, total)} / ${total}`}
          </span>
        </div>
        {!isSummary && (
          <Button size="sm" onClick={() => void later()} disabled={busy} title="Ответы сохранены — продолжите с этого места">
            Настроить позже
          </Button>
        )}
      </header>

      <main id="main" className={styles.feed} aria-busy={busy}>
        {view.history.length > 0 && (
          <ol className={styles.history} aria-label="Ответы">
            {view.history.map((h) => (
              <li key={h.stepId} className={styles.pair}>
                <div className={styles.bot}>
                  {h.lead && <p className={styles.lead}>{h.lead}</p>}
                  <p className={styles.q}>{h.question}</p>
                </div>
                <div className={styles.me}>
                  {h.answer === null ? <span className={styles.skippedText}>Пропущено</span> : <span>{h.answer}</span>}
                  {h.editable && (
                    <button type="button" className={styles.edit} onClick={() => void act({ action: 'goto', stepId: h.stepId })} disabled={busy}>
                      {h.answer === null ? 'ответить' : 'изменить'}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        <section ref={currentRef} tabIndex={-1} className={styles.current} aria-labelledby="ob-q" aria-live="polite">
          <div className={styles.bot}>
            {cur.lead && <p className={styles.lead}>{cur.lead}</p>}
            <Kicker>{cur.eyebrow}</Kicker>
            <h1 id="ob-q" className={styles.title}>
              {cur.question}
            </h1>
            {cur.sub && <p className={styles.sub}>{cur.sub}</p>}
          </div>

          {isSummary && view.summary ? (
            <Summary view={view} busy={busy} onGoto={(stepId) => void act({ action: 'goto', stepId })} onFinish={(t) => void finish(t)} />
          ) : (
            <StepInput
              key={cur.id}
              step={cur}
              consentVersion={view.consent.version}
              consentText={consentText}
              busy={busy}
              onAnswer={(value) => void act({ action: 'answer', stepId: cur.id, value })}
            />
          )}

          {error && <Notice tone="error">{error}</Notice>}

          {!isSummary && !cur.required && (
            <div className={styles.skipRow}>
              <button type="button" className={styles.skip} onClick={() => void act({ action: 'skip', stepId: cur.id })} disabled={busy}>
                Пропустить
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
