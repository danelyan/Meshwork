'use client';

import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react';

import { type OnboardingAction, completeOnboarding, onboardingAct, onboardingLater } from '@/lib/api';
import type { EmployerRestoredChat } from '@/server/agent/employer/restore';
import type { RestoredChat } from '@/server/agent/restore';
import type { ChatDemoContext } from '@/server/demo/context';
import { checkInn } from '@/server/onboarding/inn';
import { asideToModel, looksLikeQuestion, matchStepText } from '@/server/onboarding/match';
import type { OnboardingView, StepView } from '@/server/onboarding/types';

import { CompanionStage } from '../avatar/CompanionStage';
import { CompanionVoiceProvider, useCompanionVoice } from '../avatar/voice';
import { Chat } from '../Chat';
import { AssistantChat, EMPLOYER_SUGGESTIONS } from '../employer/AssistantChat';
import { extractUrls } from '@/lib/links';

import { useAttachments } from '../chat/attachments';
import { AssistantRow, Bubble, Composer, ProgressLine, QuickReplies, QuietAction, Reply, ReplySkeleton, type ReplyLine, Thread, Typing, UserBubble } from '../chat/Thread';
import { Brand } from '../shell/Brand';
import { Button, VisuallyHidden } from '../ui';

import { useStickToBottom } from '../chat/scroll';

import styles from './Onboarding.module.css';
import { AsideRows, groupAsides, useAsides } from './Asides';
import { DocumentsRows, useDocumentsRun } from './DocumentsRun';
import { parseSalary, salaryText } from './salary';
import { StepControls } from './StepControls';

export interface OnboardingChatProps {
  initial: OnboardingView;
  /** Абзацы текста согласия (server/onboarding/consent-text.ts). */
  consentText: string[];
  /**
   * Консультант кандидата: свободные вопросы посреди шагов и продолжение ленты после итога — один
   * разговор. `restored` — последний разговор (реплики со stepId — вопросы посреди шагов).
   */
  consultant?: { demo?: ChatDemoContext; restored?: RestoredChat };
  /** После итога работодателя лента продолжается помощником по подбору. */
  employerAssistant?: { demoNoLlm?: boolean; restored?: EmployerRestoredChat };
  /**
   * `consultant` — лента внутри /consultant (решение владельца 10.10: онбординг и консультант —
   * одна страница): без своей шапки сайта и аватара (голова — в ConsultantScene), заголовок
   * консультанта. `page` — отдельная /onboarding (аккаунт без роли, работодатель).
   */
  variant?: 'page' | 'consultant';
}

/** Адрес ленты кандидата: онбординг и консультация — на одной странице. */
export const CANDIDATE_FEED_PATH = '/consultant';

/** Заготовки без модели: до роли «специалист» свободный текст в модель не уходит (граница доверия). */
export const PRE_ROLE_REPLY = 'Сначала выбери вариант кнопкой выше - после этого отвечу на любой вопрос.';
export const EMPLOYER_ASIDE_REPLY = 'На свободные вопросы помощник по подбору ответит сразу после знакомства - в этой же ленте. Пока выбери вариант выше или напиши его.';

/** Шаги, где отвечают полем ввода внизу ленты: текст, своё значение, документы (файлы и ссылки), зарплата числом. */
const typesText = (s: StepView) => s.kind === 'text' || s.kind === 'files' || s.kind === 'range' || (s.allowCustom && (s.kind === 'one' || s.kind === 'chips'));

const multiOf = (s: StepView) => (Array.isArray(s.value) ? (s.value as string[]) : []);
const extraOf = (s: StepView) => (s.kind === 'chips' ? multiOf(s).filter((v) => !(s.options ?? []).some((o) => o.value === v)) : []);
const draftOf = (s: StepView) => (s.kind === 'text' && typeof s.value === 'string' ? s.value : '');

/**
 * Онбординг — лента-чат помощника ФСП Карьеры (E-02, решение владельца 09.10): реплика появляется
 * с «печатает», варианты — чипами под ней, ответ становится пузырём справа, текст — полем внизу.
 * Без «Далее» и счётчика шагов: прогресс — тонкая полоса. После итога та же лента продолжается
 * карьерным консультантом (Chat embedded). Логика шагов — на сервере; клиент показывает OnboardingView.
 */
export function OnboardingChat(props: OnboardingChatProps) {
  // Сцена с головой (AvatarScene, /design/consultant-*) держит провайдер голоса сама: лента подхватывает его.
  const outer = useCompanionVoice();
  if (outer) return <OnboardingChatBody {...props} />;
  return (
    <CompanionVoiceProvider>
      <OnboardingChatBody {...props} />
    </CompanionVoiceProvider>
  );
}

function OnboardingChatBody({ initial, consentText, consultant, employerAssistant, variant = 'page' }: OnboardingChatProps) {
  const inConsultant = variant === 'consultant';
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ text: string; quiet?: boolean } | null>(null);
  const [turn, setTurn] = useState(0);
  // Вернулся к завершённому знакомству (это и есть лента /consultant после итога): сводку не
  // перепечатываем, разговор и поле ввода — сразу.
  const settled = initial.onboarded && initial.current.kind === 'summary';
  const [ready, setReady] = useState(settled);
  const [draft, setDraft] = useState(() => draftOf(initial.current));
  const [sel, setSel] = useState(() => multiOf(initial.current));
  const [extra, setExtra] = useState(() => extraOf(initial.current));
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const onboardedRef = useRef(initial.onboarded);
  const roleRef = useRef(initial.role);
  const att = useAttachments();
  // Голос компаньона: реплика нового шага и ответы консультанта озвучиваются, если включено.
  const voice = useCompanionVoice();
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // Один разговор с консультантом: вопросы посреди шагов, разбор документов и чат после итога.
  const convRef = useRef<string | undefined>(consultant?.restored?.conversationId ?? undefined);
  const [convId, setConvId] = useState(convRef.current);
  const docs = useDocumentsRun({ conversation: convRef, onConversation: setConvId });
  const asides = useAsides(groupAsides(consultant?.restored?.items ?? []), convRef, setConvId);
  // Обычные реплики разговора — встроенному консультанту, только если человек вернулся к завершённому знакомству.
  const [restoredRest] = useState(() => (initial.onboarded && initial.current.kind === 'summary' ? (consultant?.restored?.items ?? []).filter((it) => !it.stepId) : []));

  const cur = view.current;
  const isSummary = cur.kind === 'summary';
  const canType = ready && !busy && !asides.asking && !isSummary && typesText(cur);
  // Свободный текст: на любом шаге, кроме согласия (его дают только кнопкой) и итога.
  const canInput = ready && !busy && !asides.asking && !isSummary && cur.kind !== 'consent';
  const toModel = asideToModel(view.role, cur.kind);
  const curAsides = asides.byStep[cur.id];

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
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [curAsides?.length]);

  const act = useCallback(async (body: OnboardingAction, bubble?: { text: string; quiet?: boolean }) => {
    setBusy(true);
    setError(null);
    setPending(bubble ?? null);
    try {
      const v = await onboardingAct(body);
      // Роль выбрана — страница /consultant перерисовывается под роль (данные кандидата или помощник
      // по подбору приходят с сервера); шаги на сервере, откроется с того же места; кука уже обновлена.
      const roleChosen = roleRef.current === 'pending' && v.role !== 'pending';
      roleRef.current = v.role;
      if (roleChosen) {
        window.location.assign(CANDIDATE_FEED_PATH);
        return;
      }
      voiceRef.current?.speak(`${v.current.lead} ${v.current.question}`);
      setView(v);
      setDraft(draftOf(v.current));
      setSel(multiOf(v.current));
      setExtra(extraOf(v.current));
      setReady(false);
      setTurn((t) => t + 1);
      if (v.current.kind === 'files') docs.reset();
      att.clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не получилось. Повтори.');
    } finally {
      setPending(null);
      setBusy(false);
    }
    // docs/att — стабильные колбэки хуков
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback((path: string) => {
    window.location.assign(path);
  }, []);

  async function later() {
    setBusy(true);
    setError(null);
    try {
      // Кандидату сервер ставит знакомство на паузу и ведёт сюда же: лента станет свободным разговором.
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

  /** Текст не ответ на шаг: консультанту (после роли «специалист») или заготовка без модели. */
  function aside(text: string) {
    setError(null);
    setDraft('');
    if (toModel) return void asides.ask(cur.id, text);
    asides.local(cur.id, text, view.role === 'employer' || view.scenario === 'employer' ? EMPLOYER_ASIDE_REPLY : PRE_ROLE_REPLY);
  }

  function submitDraft() {
    if (!canInput) return;
    const v = draft.trim();
    if (cur.kind === 'files') {
      // Ни файла, ни ссылки, но есть текст — это вопрос, а не материалы.
      if (v && att.ready.length === 0 && !att.uploading && extractUrls(v).length === 0 && toModel) return aside(v);
      return submitDocuments();
    }
    if (!v) return;
    // Текст совпал с вариантом шага — ответ тем же путём, что клик.
    const m = matchStepText(cur, v);
    if (m) {
      setError(null);
      setDraft('');
      return answer(m.value, m.text);
    }
    if (!typesText(cur)) return aside(v);
    if (looksLikeQuestion(v) && cur.id !== 'inn' && toModel) return aside(v);
    if (cur.kind === 'range') {
      const r = parseSalary(v, cur.range!);
      // Есть цифры — это попытка суммы (подсказка об ошибке), без цифр — вопрос консультанту.
      if ('error' in r) return toModel && !/\d/.test(v) ? aside(v) : setError(r.error);
      setError(null);
      setDraft('');
      return answer(r, salaryText(r, cur.range!));
    }
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

  /** Документы: файлы из композера и ссылки из текста уходят в разбор консультанта прямо в ленте. */
  function submitDocuments() {
    if (docs.running) return;
    if (att.uploading) return setError('Дождись окончания загрузки файлов.');
    const text = draft.trim();
    const urls = extractUrls(text);
    const files = att.ready;
    if (urls.length + files.length === 0) {
      return setError('Не вижу ни файла, ни ссылки. Прикрепи резюме скрепкой, перетащи его в ленту или вставь ссылку на GitHub или портфолио - или пропусти шаг.');
    }
    setError(null);
    setDraft('');
    att.clear();
    void docs.send({ text: text || 'Вот мои материалы.', uploadIds: files.map((f) => f.id), urls, fileNames: files.map((f) => f.name) });
  }

  const summaryLines: ReplyLine[] =
    isSummary && view.summary
      ? [
          ...view.summary.items.map((it) => ({ text: `${it.label}: ${it.value}` })),
          ...view.summary.warnings.map((w) => ({ text: w, secondary: true })),
          ...(view.summary.skipped.length ? [{ text: `Пропущено: ${view.summary.skipped.map((it) => it.label).join(', ')} - можно ответить сейчас или позже. Любой ответ выше можно изменить.`, secondary: true }] : []),
        ]
      : [];
  const lines: ReplyLine[] = [
    { text: cur.lead },
    { text: cur.question, id: 'ob-q' },
    ...(cur.sub ? [{ text: cur.sub, secondary: true }] : []),
    ...(cur.hint ? [{ text: cur.hint, secondary: true }] : []),
    ...summaryLines,
  ];
  const consentExtra =
    cur.kind === 'consent' ? (
      <details className={styles.consent}>
        <summary>Текст согласия</summary>
        {consentText.map((p) => (
          <p key={p}>{p}</p>
        ))}
        <p className={styles.demoNote}>
          Черновик, версия {view.consent.version}. Полный текст -{' '}
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
        { value: `go:${view.test.href}`, label: view.test.ready ? 'Пройти тест на грейд' : 'Тест на грейд (скоро) - в профиль' },
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
  const composerHint = inn?.ok ? 'Контрольная сумма сходится · реестр ФНС - демо, не подключён' : cur.kind === 'chips' && canType ? 'Enter - добавить своё' : undefined;
  const placeholder =
    !ready || busy || asides.asking
      ? ''
      : cur.kind === 'consent'
        ? 'Выбери вариант выше'
      : cur.kind === 'files'
        ? 'Прикрепи резюме или вставь ссылку'
        : cur.kind === 'range'
          ? `Или напиши сумму: ${cur.range!.defaults.from}–${cur.range!.defaults.to}`
          : typesText(cur)
            ? (cur.placeholder ?? (cur.kind === 'text' ? 'Напиши ответ' : 'Или напиши своё'))
            : toModel
              ? 'Выбери вариант выше или задай вопрос'
              : 'Выбери вариант выше или напиши его';
  const docsDone = cur.kind === 'files' && docs.started && !docs.running;
  const setThinking = voice?.setThinking;
  const thinking = busy || asides.asking || docs.running;
  useEffect(() => {
    setThinking?.(thinking);
  }, [thinking, setThinking]);

  // Внутри /consultant main#main уже есть (layout кабинета) — лента в div.
  const Feed = inConsultant ? 'div' : 'main';
  return (
    <div className={inConsultant ? `${styles.shell} ${styles.inScene}` : styles.shell}>
      <header className={styles.top}>
        <div className={styles.topRow}>
          {inConsultant ? (
            <h1 className={styles.sceneTitle}>
              {view.scenario === 'employer' ? 'Помощник по подбору' : 'Карьерный консультант'}
              <span className={styles.title}>{isSummary ? 'Ведёт по платформе' : 'Знакомство'}</span>
            </h1>
          ) : (
            <>
              <Brand />
              <span className={styles.title}>Знакомство</span>
            </>
          )}
          {inConsultant && isSummary && view.scenario !== 'employer' && (
            <nav className={styles.routes} aria-label="Следующий шаг">
              <Button href="/profile" size="sm">Профиль</Button>
              <Button href="/test" size="sm">Тест</Button>
            </nav>
          )}
          {!isSummary && (
            <Button size="sm" onClick={() => void later()} disabled={busy} title="Ответы сохранены - продолжишь с этого места">
              Настроить позже
            </Button>
          )}
        </div>
        <ProgressLine value={isSummary ? view.progress.total : view.progress.done} max={view.progress.total} label={`Пройдено ${view.progress.done} из ${view.progress.total}`} />
      </header>

      <Feed id={inConsultant ? undefined : 'main'} ref={feedRef as RefObject<HTMLDivElement>} className={styles.feed} aria-busy={busy}>
        {!inConsultant && (
          <VisuallyHidden>
            <h1>Знакомство с помощником ФСП Карьеры</h1>
          </VisuallyHidden>
        )}
        {!inConsultant && <CompanionStage className={styles.stage} />}
        <Thread label="Переписка с помощником">
          {view.history.map((h) => (
            <HistoryPair
              key={h.stepId}
              lead={h.lead}
              question={h.question}
              answer={h.answer}
              asides={<AsideRows items={asides.byStep[h.stepId]} locked />}
              onEdit={h.editable && !busy && !asides.asking ? () => void act({ action: 'goto', stepId: h.stepId }) : undefined}
            />
          ))}

          <AssistantRow testId="ob-current">
            <Reply key={`${cur.id}:${turn}`} lines={lines} animate={!(settled && turn === 0)} onDone={() => setReady(true)} extra={consentExtra} />
          </AssistantRow>

          <AsideRows items={curAsides} locked={asides.asking} />
          {asides.asking && !replyingIn(curAsides) && (
            <AssistantRow>
              <Typing />
            </AssistantRow>
          )}
          {curAsides?.length && !asides.asking && !isSummary ? (
            <AssistantRow mark={false} testId="ob-return">
              <Reply lines={[{ text: `Вернёмся к вопросу: ${cur.question}`, secondary: true }]} />
            </AssistantRow>
          ) : null}

          {cur.kind === 'files' && <DocumentsRows run={docs} />}
          {cur.kind === 'files' && docs.running && !docs.replying && (
            <AssistantRow>
              <Typing />
            </AssistantRow>
          )}
          {docsDone && !busy && (
            <AssistantRow mark={false} testId="ob-docs-next">
              <QuickReplies
                label="Что дальше"
                items={[{ value: 'next', label: 'Дальше', note: `материалов: ${docs.totals.uploadIds.length + docs.totals.urls.length}, утверждений: ${docs.totals.claims}` }]}
                onPick={() => answer(docs.totals, `Материалы: ${docs.totals.uploadIds.length + docs.totals.urls.length}, утверждений найдено: ${docs.totals.claims}`)}
              />
            </AssistantRow>
          )}
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

          {ready && !busy && !asides.asking && !isSummary && (
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

          {ready && isSummary && view.summary && (employer ? !employerAssistant : !consultant) && (
            <AssistantRow mark={false} testId="ob-summary">
              <QuickReplies label="Что дальше" items={nextSteps} disabled={busy} onPick={onNext} />
            </AssistantRow>
          )}
        </Thread>

        {consultantMode && (
          <Chat
            demo={consultant.demo}
            initial={{ conversationId: convId ?? null, items: restoredRest }}
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
            disabled={!canInput}
            sending={docs.running || asides.asking}
            voice={canInput && cur.id !== 'inn' && cur.kind !== 'chips'}
            multiline={(cur.maxLength ?? 0) > 200 || cur.kind === 'files'}
            maxLength={cur.kind === 'text' ? cur.maxLength : cur.kind === 'files' ? 4000 : toModel ? 2000 : 200}
            attachments={cur.kind === 'files' && ready ? { files: att.files, onAdd: att.add, onRemove: att.remove } : undefined}
            inputMode={cur.id === 'inn' ? 'numeric' : undefined}
            placeholder={placeholder}
            inputRef={inputRef}
            sendLabel={cur.kind === 'chips' ? 'Добавить' : 'Отправить'}
            allowEmpty={cur.kind === 'files' && att.ready.length > 0}
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
      </Feed>
    </div>
  );
}

/** Ответ консультанта на свободный вопрос уже пошёл в ленту (дальше видно по стриму, «печатает» не нужно). */
function replyingIn(items: { role: string; event?: { type: string } }[] | undefined): boolean {
  if (!items) return false;
  const lastUser = items.findLastIndex((it) => it.role === 'user');
  return items.slice(lastUser + 1).some((it) => it.role === 'agent' && (it.event?.type === 'message' || it.event?.type === 'delta'));
}

function HistoryPair({ lead, question, answer, asides, onEdit }: { lead: string; question: string; answer: string | null; asides?: ReactNode; onEdit?: () => void }) {
  return (
    <>
      <AssistantRow>
        <Reply lines={[{ text: lead }, { text: question }]} />
      </AssistantRow>
      {asides}
      <UserBubble quiet={answer === null} action={onEdit ? { label: answer === null ? 'ответить' : 'изменить', onClick: onEdit } : undefined}>
        {answer ?? 'пропущу'}
      </UserBubble>
    </>
  );
}
