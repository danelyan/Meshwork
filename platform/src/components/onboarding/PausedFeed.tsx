'use client';

import { Fragment, useState } from 'react';

import { onboardingAct } from '@/lib/api';
import type { EmployerRestoredChat, EmployerRestoredItem } from '@/server/agent/employer/restore';
import type { RestoredChat, RestoredItem } from '@/server/agent/restore';
import type { ChatDemoContext } from '@/server/demo/context';
import type { OnboardingView } from '@/server/onboarding/types';

import { CompanionVoiceProvider, useCompanionVoice } from '../avatar/voice';
import { Chat } from '../Chat';
import { AssistantChat, EmployerAsideRows } from '../employer/AssistantChat';
import { AssistantRow, Bubble, ProgressLine, Reply, Thread, UserBubble } from '../chat/Thread';
import { Button } from '../ui';

import { AsideRows, groupAsides } from './Asides';
import { useSoftGo } from './soft-nav';
import styles from './Onboarding.module.css';

/** Подпись кнопки возврата работодателя; её же называет помощник в напоминании (server/agent/employer/loop.ts). */
export const RESUME_LABEL = 'Вернуться к знакомству';
/** Кандидату знакомство — вопросы-подсказки в чате (решение владельца 11.10); подпись называет и консультант (onboarding-aside.ts). */
export const FILL_LABEL = 'Дополнить профиль';

export interface PausedFeedProps {
  view: OnboardingView;
  demo?: ChatDemoContext;
  restored?: RestoredChat;
  /** Работодатель: свободный разговор идёт с помощником по подбору (его таблицы разговоров), не с консультантом. */
  employer?: { demoNoLlm?: boolean; restored?: EmployerRestoredChat };
}

type Tagged = { stepId?: string; paused?: true };

/** Реплики паузы текущего шага и обычный разговор - в чат ниже; остальное (вопросы посреди шагов, прежние паузы) - под своими шагами. */
function splitFeed<T extends Tagged>(items: T[], curId: string): { aside: T[]; rest: T[] } {
  const inChat = (it: T) => !it.stepId || (it.paused === true && it.stepId === curId);
  return { aside: items.filter((it) => !inChat(it)), rest: items.filter(inChat) };
}

/**
 * Знакомство на паузе («Настроить позже» на /consultant, решение владельца 10.10): пройденные шаги
 * остаются началом ленты, дальше — свободный разговор с консультантом, онбординг не завершается.
 * «Вернуться к знакомству» открывает текущий шаг (goto снимает паузу на сервере) — лента
 * перерисовывается лентой шагов мягким обновлением (soft-nav.ts), без перезагрузки страницы. Пауза хранится на сервере (OnboardingState.meta) и переживает перезагрузку.
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

function PausedFeedBody({ view, demo, restored, employer }: PausedFeedProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const softGo = useSoftGo();
  const cur = view.current;
  // Разговор этой паузы (на текущем шаге) — в чате ниже; вопросы посреди шагов и разговоры прежних
  // пауз — под своими шагами (хронология ленты).
  const [split] = useState(() => splitFeed<RestoredItem>(restored?.items ?? [], cur.id));
  const [asides] = useState(() => groupAsides(split.aside));
  const rest = split.rest;
  const [empSplit] = useState(() => splitFeed<EmployerRestoredItem>(employer?.restored?.items ?? [], cur.id));
  const [empAsides] = useState(() => {
    const out: Record<string, EmployerRestoredItem[]> = {};
    for (const it of empSplit.aside) (out[it.stepId!] ??= []).push(it);
    return out;
  });
  const isEmployer = employer !== undefined;

  async function resume() {
    setBusy(true);
    setError(null);
    try {
      await onboardingAct({ action: 'goto', stepId: cur.id });
      // без перезагрузки: сервер отдаст ленту шагов, сцена с головой остаётся
      softGo('/consultant');
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
            {isEmployer ? 'Помощник по подбору' : 'Карьерный консультант'}
            <span className={styles.title}>{isEmployer ? 'Знакомство на паузе' : 'Ведёт по платформе'}</span>
          </h1>
          {isEmployer && (
            <Button size="sm" onClick={() => void resume()} disabled={busy} title="Продолжишь с того же шага - ответы сохранены">
              {RESUME_LABEL}
            </Button>
          )}
        </div>
        {isEmployer && <ProgressLine value={view.progress.done} max={view.progress.total} label={`Пройдено ${view.progress.done} из ${view.progress.total}`} />}
      </header>

      <div className={styles.feed}>
        <Thread label="Переписка с помощником">
          {view.history.map((h) => (
            <Fragment key={h.stepId}>
              <AssistantRow>
                <Reply lines={[{ text: h.lead }, { text: h.question }]} />
              </AssistantRow>
              <AsideRows items={asides[h.stepId]} locked />
              <EmployerAsideRows items={empAsides[h.stepId]} />
              <UserBubble quiet={h.answer === null}>{h.answer ?? 'пропущу'}</UserBubble>
            </Fragment>
          ))}
          {isEmployer && (
            <AssistantRow testId="ob-paused">
              <Reply
                lines={[
                  { text: `Знакомство на паузе - остановились на вопросе «${cur.question}». Ответы сохранены, вернуться можно в любой момент.` },
                  { text: 'Пока спрашивай что угодно - я на связи.', secondary: true },
                ]}
              />
            </AssistantRow>
          )}
          <AsideRows items={asides[cur.id]} locked />
          <EmployerAsideRows items={empAsides[cur.id]} />
          {error && (
            <AssistantRow mark={false}>
              <Bubble tone="error">{error}</Bubble>
            </AssistantRow>
          )}
        </Thread>

        {isEmployer ? (
          <AssistantChat
            demoNoLlm={employer.demoNoLlm}
            initial={{ conversationId: employer.restored?.conversationId ?? null, items: empSplit.rest }}
            embedded={{
              suggestions: [{ value: 'resume', label: RESUME_LABEL, note: `с вопроса «${cur.label}»` }],
              onSuggestion: (v) => {
                if (v !== 'resume') return false;
                void resume();
                return true;
              },
            }}
          />
        ) : (
          <Chat
            demo={demo}
            initial={{ conversationId: restored?.conversationId ?? null, items: rest }}
            embedded={{
              suggestions: [{ value: 'resume', label: FILL_LABEL, note: `вопрос «${cur.label}»` }],
              pinned: { value: 'resume', label: FILL_LABEL, note: `вопрос «${cur.label}»` },
              onSuggestion: (v) => {
                if (v === 'resume') void resume();
              },
            }}
          />
        )}
      </div>
    </div>
  );
}
