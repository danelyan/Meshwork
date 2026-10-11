'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import {
  answerTestApi,
  ApiError,
  type AttemptView,
  confirmJuniorApi,
  finishTestApi,
  getRecommendations,
  listTestAttemptsApi,
  type AttemptSummary,
  getTestAttemptApi,
  startConfirmTestApi,
  startTestApi,
  testEligibilityApi,
} from '@/lib/api';
import { GRADE_LABEL, GRADES, isGrade, type Grade } from '@/lib/grades';
import { isSpecialization, SPEC_LABEL, SPECIALIZATIONS, subcategoriesFor, subcategoryLabel, type Specialization } from '@/lib/directions';
import { formatDate } from '@/lib/labels';
import { DEFAULT_ITEM_LIMITS, formatItemRange, type ItemLimits } from '@/lib/test-limits';

import { ObjectionButton } from './consent/ObjectionButton';
import { useBareShell } from './shell/ShellFrame';
import styles from './TestPage.module.css';
import type { ItemView, JuryResult } from '@/server/test/types';

import { useIntegritySignals, type SignalTotals } from './useIntegritySignals';
import { Button, Chip, Field, Kicker, Notice, Panel, Tag } from './ui';
import ui from './ui.module.css';

type Spec = Specialization;

function isSpec(v: string | null): v is Spec {
  return isSpecialization(v);
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** Мягкий таймер задания: показывает прошедшее время, по истечении лимита — пометка, без блокировки. */
function SoftTimer({ askedAt, limitSec }: { askedAt: string; limitSec: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [askedAt]);
  const elapsed = Math.max(0, Math.floor((now - new Date(askedAt).getTime()) / 1000));
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const over = elapsed > limitSec;
  return (
    <span className={`${styles.timer} ${over ? styles.timerOver : ''}`} aria-live="off" data-testid="timer">
      {mm}:{ss}
      {over && <span className={ui.muted}> · лимит {Math.round(limitSec / 60)} мин превышен, ответить всё ещё можно</span>}
    </span>
  );
}

/** Код задания с номерами строк (ответ «номер строки» считается по ним). */
function CodeBlock({ code, numbered }: { code: string; numbered: boolean }) {
  const lines = code.split('\n');
  return (
    <pre className={styles.code} tabIndex={0}>
      {numbered ? (
        <ol className={styles.lines}>
          {lines.map((l, i) => (
            <li key={i}>
              <span className={styles.ln} aria-hidden="true">
                {i + 1}
              </span>
              <span>{l || ' '}</span>
            </li>
          ))}
        </ol>
      ) : (
        <code>{code}</code>
      )}
    </pre>
  );
}

function ExampleTask() {
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<boolean | null>(null);
  const code = ['def recent_total(orders, now):', '    total = 0', '    for o in orders:', '        if (now - o.created).days < 30:', '            total += o.amount', '        return total', '    return 0'];
  return <aside className={styles.example} aria-label="Пример задания">
    <div className={styles.exampleLabel}><Kicker>Попробуйте формат</Kicker><Tag>Пример · Python</Tag></div>
    <h2>Найдите ошибку.</h2>
    <p>Функция должна суммировать заказы за последние 30 дней, но обрабатывает только первый заказ. На какой строке ошибка?</p>
    <pre className={styles.exampleCode}><code>{code.map((line, index) => <span key={index} data-correct={result === true && index === 5}><i>{index + 1}</i>{line}</span>)}</code></pre>
    <form onSubmit={(event) => { event.preventDefault(); setResult(answer.trim() === '6'); }}>
      <label htmlFor="example-line">Номер строки</label>
      <div className={styles.exampleAnswer}><input id="example-line" type="number" min="1" max="7" required value={answer} onChange={(event) => { setAnswer(event.target.value); setResult(null); }} placeholder="Например, 4" /><Button type="submit">Проверить →</Button></div>
    </form>
    {result !== null && <p className={styles.exampleResult} data-correct={result} role="status">{result ? 'Верно. return находится внутри цикла: нужно вынести его на уровень ниже по отступу.' : 'Пока нет. Посмотрите, в какой момент функция выходит из цикла.'}</p>}
    <p className={styles.exampleFine}>Это пример. Ответ не влияет на категорию и историю тестов.</p>
  </aside>;
}

const RULES_DURING = [
  'Нельзя покидать вкладку с заданием и копировать текст',
  'Нельзя пользоваться поисковиками и нейросетями',
  'Не отвлекайтесь на звонки и уведомления — проверьте интернет и зарядку',
];

/** Экран правил перед стартом, как на крупных площадках. Что именно и как проверяется - не раскрываем. */
function RulesBlock({ retakeAfter }: { retakeAfter: string | undefined }) {
  const after = [
    'Если не получится — работодатель не увидит',
    `Следующая попытка — через ${retakeAfter ?? 'установленный интервал'}`,
    'Отключите расширения браузера — они могут помешать',
  ];
  return (
    <Panel as="section" aria-label="Правила теста" className={styles.rulesPanel} data-testid="test-rules">
      <div className={styles.ruleStep}>
        <span className={styles.ruleNum} aria-hidden="true">1</span>
        <div>
          <h2 className={styles.ruleTitle}>Во время теста</h2>
          <ul className={styles.ruleList}>{RULES_DURING.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>
      <div className={styles.ruleStep}>
        <span className={styles.ruleNum} aria-hidden="true">2</span>
        <div>
          <h2 className={styles.ruleTitle}>Что важно знать</h2>
          <ul className={styles.ruleList}>{after.map((t) => <li key={t}>{t}</li>)}</ul>
        </div>
      </div>
    </Panel>
  );
}

/** Плашка «только для жюри» (JURY_INSIGHTS): пунктирная рамка, на проде не выводится. */
function JuryPlate({ children }: { children: React.ReactNode }) {
  return (
    <aside className={styles.jury} data-testid="jury-plate" aria-label="Только для жюри">
      <p className={styles.juryHead}>Только для жюри · на проде скрыто</p>
      {children}
    </aside>
  );
}

function JuryLive({ item, totals }: { item: ItemView; totals: SignalTotals }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [item.askedAt]);
  const elapsed = Math.max(0, Math.floor((now - new Date(item.askedAt).getTime()) / 1000));
  const share = Math.round((elapsed / item.timeLimitSec) * 100);
  const shift = item.jury?.canaryShift ?? null;
  return (
    <JuryPlate>
      <dl className={styles.juryGrid}>
        <div><dt>Уходы со вкладки</dt><dd data-testid="jury-tab">{totals.tabHidden} · вне вкладки {Math.round(totals.hiddenMs / 1000)} с</dd></div>
        <div><dt>Вставки / копирования</dt><dd data-testid="jury-paste">{totals.pastes} / {totals.copies}</dd></div>
        <div><dt>Время на задании</dt><dd data-testid="jury-time">{elapsed} с из {item.timeLimitSec} с ({share}% лимита)</dd></div>
        {totals.extendedScreen !== null && <div><dt>Второй экран</dt><dd>{totals.extendedScreen ? 'подключён (пометка)' : 'нет'}</dd></div>}
      </dl>
      {shift !== null && (
        <p className={styles.juryNote} data-testid="jury-canary">
          В условии скрыта ловушка для нейросети: ответ модели будет ключ + {shift}.
        </p>
      )}
    </JuryPlate>
  );
}

export function JuryResultPlate({ jury }: { jury: JuryResult }) {
  const LEVEL = { low: 'низкий', medium: 'средний', high: 'высокий' } as const;
  return (
    <JuryPlate>
      <p data-testid="jury-level">Риск: <b>{LEVEL[jury.level]}</b>{jury.lzStar !== null ? ` · lz* = ${jury.lzStar.toFixed(2)}` : ''}</p>
      {jury.reasons.length > 0 ? (
        <ul className={styles.juryList} data-testid="jury-reasons">
          {jury.reasons.map((r, i) => (
            <li key={`${r.code}-${i}`}>
              <b>{r.label}</b>
              {r.item !== undefined ? ` (задание ${r.item})` : ''} — {r.detail}
            </li>
          ))}
        </ul>
      ) : (
        <p className={ui.muted}>Признаков нет.</p>
      )}
      {jury.flaggedItems.length > 0 && <p>Отмеченные задания: {jury.flaggedItems.join(', ')}</p>}
      {jury.notes.length > 0 && <p>{jury.notes.join('; ')}</p>}
      <p data-testid="jury-sees">Кандидат видит: {jury.candidateSees}</p>
      <p>Работодатель видит: {jury.employerSees}</p>
    </JuryPlate>
  );
}

function IntroScreen({
  onStart,
  initial,
  itemLimits,
}: {
  onStart: (s: Spec, g: Grade, sub: string | null) => Promise<void>;
  initial: { spec: Spec | null; grade: Grade | null };
  /** Лимиты основной фазы из policy (с учётом TEST_ITEM_LIMITS) — для текста «N–M коротких заданий». */
  itemLimits: ItemLimits;
}) {
  const [history, setHistory] = useState<AttemptSummary[]>([]);
  useEffect(() => { let alive = true; listTestAttemptsApi().then((attempts) => { if (alive) setHistory(attempts); }, () => undefined); return () => { alive = false; }; }, []);
  const [spec, setSpec] = useState<Spec>(initial.spec ?? 'backend');
  const [grade, setGrade] = useState<Grade>(initial.grade ?? 'junior');
  // Подкатегория теста: null — сервер берёт из профиля (если она этого направления) и возвращает в допуске.
  const [sub, setSub] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [elig, setElig] = useState<{ allowed: boolean; reason?: string; code?: string; rules: string; retakeAfter?: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial.spec && initial.grade) return;
    getRecommendations().then(
      (r) => {
        if (!r.test) return;
        if (!initial.spec) setSpec(r.test.specialization);
        if (!initial.grade) setGrade(r.test.grade);
        setHint(r.test.reason);
      },
      () => undefined,
    );
  }, [initial.spec, initial.grade]);

  useEffect(() => {
    let alive = true;
    testEligibilityApi(spec, grade, sub).then(
      (e) => {
        if (!alive) return;
        setElig(e);
        if (!sub && e.subcategoryId) setSub(e.subcategoryId);
      },
      () => alive && setElig(null),
    );
    return () => {
      alive = false;
    };
  }, [spec, grade, sub]);

  async function start() {
    setPending(true);
    setError(null);
    try {
      await onStart(spec, grade, sub);
    } catch (e) {
      setError(errorText(e, 'Не удалось начать тест.'));
      setPending(false);
    }
  }

  return (
    <div className={`${styles.page} ${styles.introPage}`}>
      <div>
        <Kicker>Тест на грейд</Kicker>
        <h1 className={styles.h1}>Тест на грейд<i>.</i></h1>
        <p className={`${ui.muted} ${styles.lead}`}>
          {formatItemRange(itemLimits)} коротких заданий с вычисляемым ответом: число, строка, номер строки. Следующее задание подбирается по вашим ответам. Категорию
          (направление × грейд) даёт только этот тест: успешная попытка записывает её в профиль; выбор грейда - за вами. Созвон с ИИ, проект и
          защита категорию не меняют: они подтверждают отдельные утверждения профиля и видны работодателю.
        </p>
      </div>

      <div className={styles.startGrid}><div className={styles.startContent}>
      <Panel as="section" aria-label="Направление и грейд" className={styles.choice}>
        <div className={styles.choiceRow}>
          <span className={ui.label}>Направление</span>
          <div className={styles.chips} role="group" aria-label="Направление">
            {SPECIALIZATIONS.map((s) => (
              <Chip
                key={s}
                pressed={spec === s}
                onClick={() => {
                  setSpec(s);
                  setSub(null);
                }}
                disabled={pending}
              >
                {SPEC_LABEL[s]}
              </Chip>
            ))}
          </div>
        </div>
        <div className={styles.choiceRow}>
          <span className={ui.label}>Подкатегория (тест - по её заданиям)</span>
          <div className={styles.chips} role="group" aria-label="Подкатегория" data-testid="subcategories">
            {subcategoriesFor(spec).map((c) => (
              <Chip key={c.id} pressed={sub === c.id} onClick={() => setSub(c.id)} disabled={pending}>
                {c.title}
                {c.status === 'planned' ? ' · в плане' : ''}
              </Chip>
            ))}
          </div>
        </div>
        <div className={styles.choiceRow}>
          <span className={ui.label}>Грейд, который хотите подтвердить</span>
          <div className={styles.gradeChoices} role="group" aria-label="Грейд">
            {GRADES.map((g) => (
              <Chip key={g} aria-label={GRADE_LABEL[g]} pressed={grade === g} onClick={() => setGrade(g)} disabled={pending}>
                <b>{GRADE_LABEL[g]}</b><small>{grade === g ? 'Выбранный уровень' : 'Проверка тестом'}</small>
              </Chip>
            ))}
          </div>
        </div>
        {hint && (
          <p className={styles.hint} data-testid="rec-hint">
            Рекомендация консультанта: {hint}
          </p>
        )}
      </Panel>

      <RulesBlock retakeAfter={elig?.retakeAfter} />

      <ul className={styles.rules} aria-label="Правила">
        <li>Задание можно пропустить только ответом; назад вернуться нельзя.</li>
        <li>Таймер мягкий: превышение лимита не блокирует ответ, но учитывается.</li>
        <li>Неудачная попытка не снимает уже записанную категорию.</li>
        {elig?.rules && <li>{elig.rules}</li>}
      </ul>

      {elig && !elig.allowed && (
        <Notice data-testid={elig.code === 'no_test' ? 'no-test' : elig.code === 'subcategory_required' ? 'need-subcategory' : 'not-allowed'}>
          {elig.code === 'no_test' ? `Тест пока недоступен: ${elig.reason}` : elig.reason}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <div className={styles.actions}>
        <Button variant="cta" onClick={() => void start()} loading={pending} disabled={Boolean(elig && !elig.allowed)} data-testid="start">
          Начать · {SPEC_LABEL[spec]}
          {sub ? ` · ${subcategoryLabel(sub)}` : ''} · {GRADE_LABEL[grade]}
        </Button>
        <Button href="/profile">В профиль</Button>
      </div>
      <Panel className={styles.afterTest}><Kicker>Что произойдёт после</Kicker><h2>Результат станет частью профиля.</h2><p>Успешная попытка запишет категорию в профиль; если результат понадобится подтвердить, экран итога предложит короткий подтверждающий тест. Если не получится, текущая категория сохранится, а рекомендации помогут подготовиться к следующей попытке.</p><p>Созвон с ИИ, проект и защита категорию не меняют: они подтверждают отдельные утверждения профиля.</p><p>Сложность заданий - экспертная оценка: на людях банк заданий не калибровался. <Link href="/validation">Что и как проверялось</Link></p></Panel>
      </div><aside className={styles.introAside}>
        <Panel className={styles.historyCard}><h2>История</h2>{history.length ? <ol>{history.slice(0, 5).map((attempt) => <li key={attempt.id}><small>{formatDate(attempt.startedAt)}</small><b>{SPEC_LABEL[attempt.specialization]} · {GRADE_LABEL[attempt.grade]}</b><span>{attempt.status === 'passed' ? 'Подтверждён' : attempt.status === 'active' ? 'Не завершён' : attempt.status === 'abandoned' ? 'Попытка не засчитана' : 'Грейд не подтверждён'} · {attempt.correct} из {attempt.answered}</span><Button size="sm" href={`/test?attempt=${encodeURIComponent(attempt.id)}`}>Открыть попытку →</Button></li>)}</ol> : <p>Завершённых попыток пока нет.</p>}</Panel>
        <Button href="/consultant" className={styles.consultantLink}>Кира · Разберём пробелы перед тестом ↗</Button>
        <details className={styles.exampleDisclosure}><summary>Попробовать формат задания</summary><ExampleTask /></details>
      </aside></div>
    </div>
  );
}

/** Экран задания. `apiBase` — префикс API сигналов: кандидат `/api/test` (по умолчанию), режим эксперта `/api/expert`. */
export function ItemScreen({
  attempt,
  onAnswer,
  onFinish,
  apiBase,
}: {
  attempt: AttemptView;
  onAnswer: (a: string) => Promise<void>;
  onFinish: () => Promise<void>;
  apiBase?: string;
}) {
  const item = attempt.current!;
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const signals = useIntegritySignals(attempt.id, item.index, true, apiBase);

  useEffect(() => {
    setAnswer('');
    inputRef.current?.focus();
  }, [item.index]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !answer.trim()) return;
    setPending(true);
    setError(null);
    try {
      await onAnswer(answer);
      setAnswer('');
    } catch (err) {
      setError(errorText(err, 'Не удалось отправить ответ.'));
    } finally {
      setPending(false);
    }
  }

  /** Досрочное завершение: сбой API показываем там же, где ошибку отправки ответа, иначе нажатие выглядит как ничего. */
  async function finish() {
    if (pending) return;
    if (!window.confirm('Завершить тест сейчас? Итог будет посчитан по уже данным ответам.')) return;
    setPending(true);
    setError(null);
    try {
      await onFinish();
    } catch (err) {
      setError(errorText(err, 'Не удалось завершить тест.'));
    } finally {
      setPending(false);
    }
  }

  const numbered = item.format === 'line';
  const probe = attempt.phase === 'junior_probe' || attempt.phase === 'middle_probe';
  return (
    <div className={styles.page}>
      <div className={styles.progressRow}>
        <div>
          <Kicker>
            {SPEC_LABEL[attempt.specialization]}
            {attempt.subcategoryId ? ` · ${subcategoryLabel(attempt.subcategoryId)}` : ''} · {GRADE_LABEL[attempt.grade]}
          </Kicker>
          <p className={styles.progressText} data-testid="progress">
            Задание {item.index + 1}
            <span className={ui.muted}>
              {probe ? ` · дополнительное, всего до ${attempt.maxItems}` : ` · всего от ${attempt.minItems} до ${attempt.maxItems}`}
            </span>
          </p>
        </div>
        <SoftTimer askedAt={item.askedAt} limitSec={item.timeLimitSec} />
      </div>
      {item.jury && <JuryLive item={item} totals={signals.totals} />}
      {probe && (
        <Notice data-testid="junior-probe">
          Ещё несколько заданий для точности.
        </Notice>
      )}
      <div className={styles.progressBar} role="progressbar" aria-valuemin={0} aria-valuemax={attempt.maxItems} aria-valuenow={item.index} aria-label="Ход теста">
        <i style={{ width: `${Math.min(100, (item.index / attempt.maxItems) * 100)}%` }} />
      </div>

      <Panel as="section" variant="strong" className={styles.task} aria-labelledby={`${fieldId}-title`}>
        <h2 id={`${fieldId}-title`} className={styles.taskTitle}>
          {item.title}
        </h2>
        <div className={styles.condition} onCopy={signals.onCopy}>
          <p className={styles.prompt}>
            {item.prompt}
            {item.canary && (
              <span className={styles.canary} aria-hidden="true" data-testid="canary">
                {' '}
                {item.canary}
              </span>
            )}
          </p>
          {item.code && <CodeBlock code={item.code} numbered={numbered} />}
        </div>
        <form className={styles.form} onSubmit={submit}>
          <Field label={`Ответ (${item.answerHint})`}>
            <input
              ref={inputRef}
              id={fieldId}
              className={ui.input}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onPaste={signals.onPaste}
              maxLength={500}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              data-testid="answer"
            />
          </Field>
          <div className={styles.actions}>
            <Button type="submit" variant="primary" loading={pending} disabled={!answer.trim()} data-testid="submit">
              Ответить
            </Button>
            <Button size="sm" disabled={pending} onClick={() => void finish()}>
              Завершить досрочно
            </Button>
          </div>
        </form>
        {error && <Notice tone="error">{error}</Notice>}
      </Panel>
    </div>
  );
}

const CONFIRM_ERRORS: Record<string, string> = {
  confirm_not_needed: 'Подтверждающий тест для этой попытки не требуется.',
  already_confirmed: 'Грейд по этой попытке уже подтверждён.',
  confirm_used: 'Подтверждающий тест по этой попытке уже использован.',
  active_attempt: 'Сначала завершите начатую попытку теста.',
};

function confirmErrorText(e: unknown): string {
  if (e instanceof ApiError && e.code && CONFIRM_ERRORS[e.code]) return CONFIRM_ERRORS[e.code]!;
  return errorText(e, 'Не удалось начать подтверждающий тест.');
}

function ResultScreen({
  attempt,
  onConfirmJunior,
  onStartConfirm,
  onRetry,
}: {
  attempt: AttemptView;
  onConfirmJunior: () => Promise<void>;
  onStartConfirm: () => Promise<void>;
  onRetry: () => void;
}) {
  const r = attempt.result!;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showItems, setShowItems] = useState(false);
  const grade = GRADE_LABEL[attempt.grade];
  const needsConfirmation = r.status === 'needs_confirmation';
  const confirmKind = attempt.kind === 'confirm';
  // Грейд ниже заявленного (Middle → Junior, Senior → Middle), который предлагается в один клик.
  const lower = r.offeredGrade ? GRADE_LABEL[r.offeredGrade] : attempt.grade === 'senior' ? 'Middle' : 'Junior';
  const title =
    needsConfirmation ? 'Нужен подтверждающий тест' : r.status === 'abandoned' ? 'Попытка не засчитана' : r.confirmed ? `${grade} подтверждён` : r.juniorConfirmedAt ? `${lower} подтверждён` : `${grade} не подтверждён`;

  async function startConfirm() {
    setPending(true);
    setError(null);
    try {
      await onStartConfirm();
    } catch (e) {
      setError(confirmErrorText(e));
    } finally {
      setPending(false);
    }
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirmJunior();
    } catch (e) {
      setError(errorText(e, `Не удалось подтвердить ${lower}.`));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <Kicker>
          {confirmKind ? 'Подтверждающий тест' : 'Итог'} · {SPEC_LABEL[attempt.specialization]}
          {attempt.subcategoryId ? ` · ${subcategoryLabel(attempt.subcategoryId)}` : ''} · {grade}
        </Kicker>
        <h1 className={styles.h1} data-testid="result-title">
          {title}
        </h1>
      </div>

      <Panel as="section" variant="strong" className={styles.result} aria-label="Результат">
        <div className={styles.resultHead}>
          <Tag tone={r.confirmed || r.juniorConfirmedAt ? 'solid' : 'outline'}>{r.confirmed || r.juniorConfirmedAt ? 'категория записана' : 'категория не изменилась'}</Tag>
          <span className={styles.big} data-testid="score">
            {r.correct} из {r.answered}
          </span>
        </div>
        <p className={styles.explanation} data-testid="explanation">
          {r.explanation}
        </p>
        <dl className={styles.facts}>
          <div>
            <dt>Вероятность, что уровень не ниже {grade}</dt>
            <dd>{Math.round(r.pPass * 100)} %</dd>
          </div>
          {attempt.grade !== 'junior' && (
            <div>
              <dt>Уверенность в {lower}</dt>
              <dd>{Math.round((r.pLower ?? r.pJunior) * 100)}%</dd>
            </div>
          )}
          <div>
            <dt>Заданий</dt>
            <dd>{r.answered}</dd>
          </div>
        </dl>
        <p className={ui.muted} data-testid="confidence-note">
          Это уверенность теста по вашим ответам, а не вероятность найма.
        </p>
        <p className={ui.muted}>
          <ObjectionButton subject="grade_test" subjectId={attempt.id} />
        </p>
        {r.confirmedCatalogIds.length > 0 && (
          <p className={ui.muted} data-testid="confirmed-claims">
            Решённые задания подтверждают утверждения: {r.confirmedCatalogIds.join(', ')} - их уровень в профиле поднят до «платформа».
          </p>
        )}
        {needsConfirmation && (
          <div className={styles.offer} data-testid="confirm-needed">
            <p>Грейд будет присвоен после короткого подтверждающего теста: 6–8 новых заданий.</p>
            {r.integrity?.needsConfirmation !== false && (
              <Button variant="cta" onClick={() => void startConfirm()} loading={pending} data-testid="confirm-start">
                Пройти подтверждающий тест
              </Button>
            )}
          </div>
        )}
        {r.integrity?.rankingHold && !needsConfirmation && (
          <div className={styles.offer} data-testid="ranking-hold">
            <p>
              <b>Категория записана, но в подборках и поиске компаний пока не учитывается.</b> В этой попытке есть признаки, которые мы просим
              подтвердить отдельно. Это не обвинение и не снятие грейда: категория в профиле остаётся. Подтвердить её можно двумя способами:
              короткий подтверждающий тест из 6–8 новых заданий или созвон с ИИ с разбором заданий этой попытки. Не согласны с оценкой -
              оспорьте её выше, ответит человек.
            </p>
            <div className={styles.actions}>
              {r.integrity.confirmAttemptId ? (
                <Button variant="cta" href={`/test?attempt=${encodeURIComponent(r.integrity.confirmAttemptId)}`} data-testid="confirm-open">
                  Открыть подтверждающий тест
                </Button>
              ) : (
                <Button variant="cta" onClick={() => void startConfirm()} loading={pending} data-testid="confirm-start">
                  Пройти подтверждающий тест
                </Button>
              )}
              <Button href="/interview" data-testid="ranking-hold-call">
                Созвон с ИИ
              </Button>
            </div>
          </div>
        )}
        {r.juniorOffered && !needsConfirmation && (
          <div className={styles.offer} data-testid="junior-offer">
            <p>
              {grade} не подтверждён, но задания уровня {lower} решены уверенно. Подтвердить {lower} по этой же попытке? Решение за вами: без вашего согласия
              категория не меняется.
            </p>
            <Button variant="cta" onClick={() => void confirm()} loading={pending} data-testid="confirm-junior">
              Подтвердить {lower}
            </Button>
          </div>
        )}
        {error && <Notice tone="error">{error}</Notice>}
      </Panel>

      {r.jury && <JuryResultPlate jury={r.jury} />}

      <div className={styles.actions}>
        <Button variant="primary" href="/profile">
          В профиль
        </Button>
        <Button href="/profile#claims" title="Защита - подтверждающий слой: флаг к утверждению, категорию не меняет">
          Разобрать утверждение
        </Button>
        <Button onClick={onRetry}>Пройти ещё раз</Button>
        <Button size="sm" onClick={() => setShowItems((v) => !v)} aria-expanded={showItems}>
          {showItems ? 'Скрыть разбор' : 'Разбор заданий'}
        </Button>
      </div>

      {showItems && (
        <ol className={styles.review} aria-label="Разбор заданий">
          {r.items.map((it) => (
            <li key={it.index} className={`${ui.panel} ${styles.reviewItem}`}>
              <div className={styles.reviewHead}>
                <b>{it.title}</b>
                <Tag tone={it.correct ? 'solid' : 'dashed'}>{it.correct ? 'верно' : 'неверно'}</Tag>
              </div>
              <p className={ui.muted}>
                Ваш ответ: {it.answer || '-'} · верный: {it.answerKey}
              </p>
              <p>{it.explanation}</p>
            </li>
          ))}
        </ol>
      )}
      <p className={ui.muted} style={{ fontSize: 'var(--fs-sm)' }}>
        Попытка от {formatDate(attempt.startedAt)}. Разбор утверждения с консультантом после теста - подтверждающий флаг, категорию она не меняет.
      </p>
    </div>
  );
}

/** itemLimits — действующие лимиты длины (страница передаёт activeItemLimits()); без пропа — дефолт policy. */
export function TestPage({ itemLimits = DEFAULT_ITEM_LIMITS }: { itemLimits?: ItemLimits } = {}) {
  const params = useSearchParams();
  const router = useRouter();
  const attemptParam = params.get('attempt');
  const initialSpec = params.get('specialization');
  const initialGrade = params.get('grade');
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [loading, setLoading] = useState(Boolean(attemptParam));
  const [error, setError] = useState<ApiError | Error | null>(null);
  const loadedRef = useRef<string | null>(null);
  // Пока идёт попытка, шапка и подвал спрятаны: уйти со страницы случайно нельзя.
  useBareShell(attempt?.status === 'active');

  useEffect(() => {
    if (!attemptParam || loadedRef.current === attemptParam) return;
    loadedRef.current = attemptParam;
    setLoading(true);
    getTestAttemptApi(attemptParam).then(
      (a) => {
        setAttempt(a);
        setLoading(false);
      },
      (e: Error) => {
        setError(e);
        setLoading(false);
      },
    );
  }, [attemptParam]);

  async function start(spec: Spec, grade: Grade, sub: string | null) {
    const s = await startTestApi(spec, grade, sub);
    const a = await getTestAttemptApi(s.attemptId);
    loadedRef.current = s.attemptId;
    setAttempt(a);
    router.replace(`/test?attempt=${encodeURIComponent(s.attemptId)}`);
  }

  if (error) {
    const unauth = error instanceof ApiError && error.status === 401;
    return (
      <div className={styles.page}>
        <Notice tone="error">{error.message}</Notice>
        {unauth ? (
          <Button size="sm" href="/" style={{ justifySelf: 'start' }}>
            На страницу входа
          </Button>
        ) : (
          <Button size="sm" onClick={() => { setError(null); setAttempt(null); router.replace('/test'); }} style={{ justifySelf: 'start' }}>
            Начать заново
          </Button>
        )}
      </div>
    );
  }
  if (loading) {
    return (
      <div className={styles.page} aria-busy="true">
        <p className={ui.muted} role="status">
          <span className={ui.spinner} aria-hidden="true" /> Загружаю попытку…
        </p>
      </div>
    );
  }
  if (!attempt) {
    return <IntroScreen onStart={start} itemLimits={itemLimits} initial={{ spec: isSpec(initialSpec) ? initialSpec : null, grade: isGrade(initialGrade) ? initialGrade : null }} />;
  }
  if (attempt.status === 'active' && attempt.current) {
    return (
      <ItemScreen
        attempt={attempt}
        onAnswer={async (a) => setAttempt(await answerTestApi(attempt.id, a))}
        onFinish={async () => setAttempt(await finishTestApi(attempt.id))}
      />
    );
  }
  if (attempt.result) {
    return (
      <ResultScreen
        attempt={attempt}
        onConfirmJunior={async () => setAttempt(await confirmJuniorApi(attempt.id))}
        onStartConfirm={async () => {
          const s = await startConfirmTestApi(attempt.id);
          const a = await getTestAttemptApi(s.attemptId);
          loadedRef.current = s.attemptId;
          setAttempt(a);
          router.replace(`/test?attempt=${encodeURIComponent(s.attemptId)}`);
        }}
        onRetry={() => {
          setAttempt(null);
          loadedRef.current = null;
          router.replace(`/test?specialization=${attempt.specialization}&grade=${attempt.grade}`);
        }}
      />
    );
  }
  return (
    <div className={styles.page}>
      <Notice>Попытка в неожиданном состоянии. <Link href="/test">Начать заново</Link></Notice>
    </div>
  );
}
