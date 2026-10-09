'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type OnboardingAction, completeOnboarding, onboardingAct, onboardingLater } from '@/lib/api';
import type { EmployerRestoredChat } from '@/server/agent/employer/restore';
import type { RestoredChat } from '@/server/agent/restore';
import type { ChatDemoContext } from '@/server/demo/context';
import { checkInn } from '@/server/onboarding/inn';
import type { OnboardingView, StepView } from '@/server/onboarding/types';

import { Chat } from '../Chat';
import { AssistantChat, EMPLOYER_SUGGESTIONS } from '../employer/AssistantChat';
import { AssistantRow, Bubble, Composer, ProgressLine, QuickReplies, QuietAction, Reply, ReplySkeleton, type ReplyLine, Thread, UserBubble } from '../chat/Thread';
import { Brand } from '../shell/Brand';
import { Button, VisuallyHidden } from '../ui';

import { useStickToBottom } from '../chat/scroll';

import styles from './Onboarding.module.css';
import { StepControls, SummaryCard } from './StepControls';

export interface OnboardingChatProps {
  initial: OnboardingView;
  /** Абзацы текста согласия (server/onboarding/consent-text.ts). */
  consentText: string[];
  /** После итога лента продолжается консультантом (только кандидат). */
  consultant?: { demo?: ChatDemoContext; restored?: RestoredChat };
  /** После итога работодателя лента продолжается помощником по подбору. */
  employerAssistant?: { demoNoLlm?: boolean; restored?: EmployerRestoredChat };
}

/** Шаги, где отвечают полем ввода внизу ленты. */
const typesText = (s: StepView) => s.kind === 'text' || (s.allowCustom && (s.kind === 'one' || s.kind === 'chips'));

const multiOf = (s: StepView) => (Array.isArray(s.value) ? (s.value as string[]) : []);
const extraOf = (s: StepView) => (s.kind === 'chips' ? multiOf(s).filter((v) => !(s.options ?? []).some((o) => o.value === v)) : []);
const draftOf = (s: StepView) => (s.kind === 'text' && typeof s.value === 'string' ? s.value : '');

/**
 * Онбординг — лента-чат помощника ФСП Карьеры (E-02, решение владельца 09.10): реплика появляется
 * с «печатает», варианты — чипами под ней, ответ становится пузырём справа, текст — полем внизу.
 * Без «Далее» и счётчика шагов: прогресс — тонкая полоса. После итога та же лента продолжается
 * карьерным консультантом (Chat embedded). Логика шагов — на сервере; клиент показывает OnboardingView.
 */
export function OnboardingChat({ initial, consentText, consultant, employerAssistant }: OnboardingChatProps) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ text: string; quiet?: boolean } | null>(null);
  const [turn, setTurn] = useState(0);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState(() => draftOf(initial.current));
  const [sel, setSel] = useState(() => multiOf(initial.current));
  const [extra, setExtra] = useState(() => extraOf(initial.current));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const onboardedRef = useRef(initial.onboarded);

  const cur = view.current;
  const isSummary = cur.kind === 'summary';
  const canType = ready && !busy && !isSummary && typesText(cur);

  const feedRef = useRef<HTMLElement>(null);
  useStickToBottom(feedRef);
  const mountedRef = useRef(false);
  useEffect(() => {
    // Первый показ (в т.ч. перезагрузка) — сразу к текущему вопросу, дальше — плавно.
    const behavior = mountedRef.current ? 'smooth' : 'auto';
    const id = requestAnimationFrame(() => {
      mountedRef.current = true;
      endRef.current?.scrollIntoView?.({ block: 'end', behavior });
    });
    return () => cancelAnimationFrame(id);
  }, [turn, pending]);
  useEffect(() => {
    if (canType) inputRef.current?.focus({ preventScroll: true });
  }, [canType, turn]);

  const act = useCallback(async (body: OnboardingAction, bubble?: { text: string; quiet?: boolean }) => {
    setBusy(true);
    setError(null);
    setPending(bubble ?? null);
    try {
      const v = await onboardingAct(body);
      setView(v);
      setDraft(draftOf(v.current));
      setSel(multiOf(v.current));
      setExtra(extraOf(v.current));
      setReady(false);
      setTurn((t) => t + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось. Повтори.');
    } finally {
      setPending(null);
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
      setError(e instanceof Error ? e.message : 'Не получилось. Повтори.');
      setBusy(false);
    }
  }

  const ensureOnboarded = useCallback(async () => {
    if (onboardedRef.current) return null;
    const r = await completeOnboarding();
    onboardedRef.current = true;
    return r.next;
  }, []);

  async function finish(target?: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await ensureOnboarded();
      go(target ?? next ?? view.laterTarget);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось завершить. Повтори.');
      setBusy(false);
    }
  }

  const answer = (value: unknown, text: string) => void act({ action: 'answer', stepId: cur.id, value }, { text });
  const skip = () => void act({ action: 'skip', stepId: cur.id }, { text: 'пропущу', quiet: true });

  function submitDraft() {
    const v = draft.trim();
    if (!v || !canType) return;
    if (cur.kind === 'chips') {
      const all = [...(cur.options ?? []).map((o) => o.value), ...extra];
      const existing = all.find((x) => x.toLowerCase() === v.toLowerCase());
      const val = existing ?? v;
      if (!existing) setExtra((p) => [...p, v]);
      setSel((p) => (p.includes(val) ? p : [...p, val]));
      setDraft('');
      return;
    }
    if (cur.id === 'inn') {
      const r = checkInn(v);
      if (!r.ok) {
        setError(`${r.reason} Проверь цифры и отправь ещё раз.`);
        return;
      }
    }
    setError(null);
    answer(v, v);
  }

  const lines: ReplyLine[] = [
    { text: cur.lead },
    { text: cur.question, id: 'ob-q' },
    ...(cur.sub ? [{ text: cur.sub, secondary: true }] : []),
    ...(cur.hint ? [{ text: cur.hint, secondary: true }] : []),
  ];
  const consentExtra =
    cur.kind === 'consent' ? (
      <details className={styles.consent}>
        <summary>Текст согласия</summary>
        {consentText.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <p className={styles.demoNote}>
          Черновик, версия {view.consent.version}. Полный текст —{' '}
          <a href={view.consent.docUrl} target="_blank" rel="noopener">
            на странице согласия
          </a>
          .
        </p>
      </details>
    ) : undefined;

  const employer = view.scenario === 'employer';
  const skippedReplies = (view.summary?.skipped ?? []).map((it) => ({ value: `goto:${it.stepId}`, label: `Ответить: ${it.label}` }));
  const nextSteps = employer
    ? [{ value: 'go:/employer', label: 'Открыть подборку' }, ...skippedReplies]
    : [
        { value: `go:${view.test.href}`, label: view.test.ready ? 'Пройти тест на грейд' : 'Тест на грейд (скоро) — в профиль' },
        { value: 'go:/profile', label: 'Открыть профиль' },
        ...skippedReplies,
      ];
  const onNext = (v: string) => {
    if (v.startsWith('goto:')) void act({ action: 'goto', stepId: v.slice(5) });
    else void finish(v.slice(3));
  };
  const consultantMode = isSummary && ready && !employer && consultant !== undefined;
  const assistantMode = isSummary && ready && employer && employerAssistant !== undefined;

  const inn = cur.id === 'inn' && draft.trim() ? checkInn(draft) : null;
  const composerHint = inn?.ok ? 'Контрольная сумма сходится · реестр ФНС — демо, не подключён' : cur.kind === 'chips' && canType ? 'Enter — добавить своё' : undefined;
  const placeholder = !ready || busy ? '' : typesText(cur) ? (cur.placeholder ?? (cur.kind === 'text' ? 'Напиши ответ' : 'Или напиши своё')) : cur.kind === 'range' || cur.kind === 'files' ? 'Ответь в карточке выше' : 'Выбери вариант выше';

  return (
    <div className={styles.shell}>
      <header className={styles.top}>
        <div className={styles.topRow}>
          <Brand />
          <span className={styles.title}>Знакомство</span>
          {!isSummary && (
            <Button size="sm" onClick={() => void later()} disabled={busy} title="Ответы сохранены — продолжишь с этого места">
              Настроить позже
            </Button>
          )}
        </div>
        <ProgressLine value={isSummary ? view.progress.total : view.progress.done} max={view.progress.total} label={`Пройдено ${view.progress.done} из ${view.progress.total}`} />
      </header>

      <main id="main" ref={feedRef} className={styles.feed} aria-busy={busy}>
        <VisuallyHidden>
          <h1>Знакомство с помощником ФСП Карьеры</h1>
        </VisuallyHidden>
        <Thread label="Переписка с помощником">
          {view.history.map((h) => (
            <HistoryPair key={h.stepId} lead={h.lead} question={h.question} answer={h.answer} onEdit={h.editable && !busy ? () => void act({ action: 'goto', stepId: h.stepId }) : undefined} />
          ))}

          <AssistantRow testId="ob-current">
            <Reply key={`${cur.id}:${turn}`} lines={lines} animate onDone={() => setReady(true)} extra={consentExtra} />
          </AssistantRow>

          {pending && <UserBubble quiet={pending.quiet}>{pending.text}</UserBubble>}
          {busy && pending && (
            <AssistantRow>
              <ReplySkeleton />
            </AssistantRow>
          )}
          {error && (
            <AssistantRow mark={false}>
              <Bubble tone="error">{error}</Bubble>
            </AssistantRow>
          )}

          {ready && !busy && !isSummary && (
            <AssistantRow mark={false} testId="ob-controls">
              <StepControls
                step={cur}
                busy={busy}
                consentVersion={view.consent.version}
                sel={sel}
                extra={extra}
                onToggle={(v) => setSel((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))}
                onAnswer={answer}
              />
            </AssistantRow>
          )}

          {ready && isSummary && view.summary && (
            <AssistantRow mark={false} testId="ob-summary">
              <SummaryCard view={view} />
              {(employer ? !employerAssistant : !consultant) && <QuickReplies label="Что дальше" items={nextSteps} disabled={busy} onPick={onNext} />}
            </AssistantRow>
          )}
        </Thread>

        {consultantMode && (
          <Chat
            demo={consultant.demo}
            initial={consultant.restored}
            embedded={{
              suggestions: nextSteps,
              onSuggestion: onNext,
              beforeSend: async () => {
                await ensureOnboarded();
              },
            }}
          />
        )}

        {assistantMode && (
          <AssistantChat
            demoNoLlm={employerAssistant.demoNoLlm}
            initial={employerAssistant.restored}
            embedded={{
              suggestions: [...EMPLOYER_SUGGESTIONS, ...nextSteps],
              onSuggestion: (v) => {
                if (!v.startsWith('go:') && !v.startsWith('goto:')) return false;
                onNext(v);
                return true;
              },
              beforeSend: async () => {
                await ensureOnboarded();
              },
            }}
          />
        )}

        <div ref={endRef} className={styles.end} />

        {!isSummary && (
          <Composer
            label={cur.kind === 'text' ? cur.label : 'Ответ'}
            value={draft}
            onChange={setDraft}
            onSubmit={submitDraft}
            disabled={!canType}
            multiline={(cur.maxLength ?? 0) > 200}
            maxLength={cur.kind === 'text' ? cur.maxLength : 60}
            inputMode={cur.id === 'inn' ? 'numeric' : undefined}
            placeholder={placeholder}
            inputRef={inputRef}
            sendLabel={cur.kind === 'chips' ? 'Добавить' : 'Отправить'}
            aside={
              !cur.required && ready ? (
                <QuietAction onClick={skip} disabled={busy}>
                  Пропустить
                </QuietAction>
              ) : undefined
            }
            hint={composerHint}
          />
        )}
      </main>
    </div>
  );
}

function HistoryPair({ lead, question, answer, onEdit }: { lead: string; question: string; answer: string | null; onEdit?: () => void }) {
  return (
    <>
      <AssistantRow>
        <Reply lines={[{ text: lead }, { text: question }]} />
      </AssistantRow>
      <UserBubble quiet={answer === null} action={onEdit ? { label: answer === null ? 'ответить' : 'изменить', onClick: onEdit } : undefined}>
        {answer ?? 'пропущу'}
      </UserBubble>
    </>
  );
}
