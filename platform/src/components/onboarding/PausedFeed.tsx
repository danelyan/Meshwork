'use client';

import { Fragment, useState } from 'react';

import { onboardingAct } from '@/lib/api';
import type { RestoredChat } from '@/server/agent/restore';
import type { ChatDemoContext } from '@/server/demo/context';
import type { OnboardingView } from '@/server/onboarding/types';

import { CompanionVoiceProvider, useCompanionVoice } from '../avatar/voice';
import { Chat } from '../Chat';
import { AssistantRow, Bubble, ProgressLine, Reply, Thread, UserBubble } from '../chat/Thread';
import { Button } from '../ui';

import { AsideRows, groupAsides } from './Asides';
import styles from './Onboarding.module.css';

/** Подпись кнопки возврата; её же называет консультант в напоминании (server/agent/onboarding-aside.ts). */
export const RESUME_LABEL = 'Вернуться к знакомству';

export interface PausedFeedProps {
  view: OnboardingView;
  demo?: ChatDemoContext;
  restored?: RestoredChat;
}

/**
 * Знакомство на паузе («Настроить позже» на /consultant, решение владельца 10.10): пройденные шаги
 * остаются началом ленты, дальше — свободный разговор с консультантом, онбординг не завершается.
 * «Вернуться к знакомству» открывает текущий шаг (goto снимает паузу на сервере) — страница
 * перерисовывается лентой шагов. Пауза хранится на сервере (OnboardingState.meta) и переживает перезагрузку.
 */
export function PausedFeed(props: PausedFeedProps) {
  // Свой провайдер голоса — только если снаружи его нет (как у Chat).
  const outer = useCompanionVoice();
  if (outer) return <PausedFeedBody {...props} />;
  return (
    <CompanionVoiceProvider>
      <PausedFeedBody {...props} />
    </CompanionVoiceProvider>
  );
}

function PausedFeedBody({ view, demo, restored }: PausedFeedProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = restored?.items ?? [];
  // Вопросы посреди шагов — под своим шагом; свободный разговор — в чате ниже.
  const [asides] = useState(() => groupAsides(items));
  const [rest] = useState(() => items.filter((it) => !it.stepId));
  const cur = view.current;

  async function resume() {
    setBusy(true);
    setError(null);
    try {
      await onboardingAct({ action: 'goto', stepId: cur.id });
      window.location.assign('/consultant');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось. Повтори.');
      setBusy(false);
    }
  }

  return (
    <div className={`${styles.shell} ${styles.inScene}`}>
      <header className={styles.top}>
        <div className={styles.topRow}>
          <h1 className={styles.sceneTitle}>
            Карьерный консультант
            <span className={styles.title}>Знакомство на паузе</span>
          </h1>
          <Button size="sm" onClick={() => void resume()} disabled={busy} title="Продолжишь с того же шага - ответы сохранены">
            {RESUME_LABEL}
          </Button>
        </div>
        <ProgressLine value={view.progress.done} max={view.progress.total} label={`Пройдено ${view.progress.done} из ${view.progress.total}`} />
      </header>

      <div className={styles.feed}>
        <Thread label="Переписка с помощником">
          {view.history.map((h) => (
            <Fragment key={h.stepId}>
              <AssistantRow>
                <Reply lines={[{ text: h.lead }, { text: h.question }]} />
              </AssistantRow>
              <AsideRows items={asides[h.stepId]} locked />
              <UserBubble quiet={h.answer === null}>{h.answer ?? 'пропущу'}</UserBubble>
            </Fragment>
          ))}
          <AssistantRow testId="ob-paused">
            <Reply
              lines={[
                { text: `Знакомство на паузе - остановились на вопросе «${cur.question}». Ответы сохранены, вернуться можно в любой момент.` },
                { text: 'Пока спрашивай что угодно - я на связи.', secondary: true },
              ]}
            />
          </AssistantRow>
          <AsideRows items={asides[cur.id]} locked />
          {error && (
            <AssistantRow mark={false}>
              <Bubble tone="error">{error}</Bubble>
            </AssistantRow>
          )}
        </Thread>

        <Chat
          demo={demo}
          initial={{ conversationId: restored?.conversationId ?? null, items: rest }}
          embedded={{
            suggestions: [{ value: 'resume', label: RESUME_LABEL, note: `с вопроса «${cur.label}»` }],
            onSuggestion: (v) => {
              if (v === 'resume') void resume();
            },
          }}
        />
      </div>
    </div>
  );
}
