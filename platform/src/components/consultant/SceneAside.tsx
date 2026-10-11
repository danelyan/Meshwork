'use client';

import Link from 'next/link';
import { useState } from 'react';

import { grantConsentApi } from '@/lib/consent-api';
import { liveStepCopy } from '@/lib/live-step';
import type { AsideDoc, JourneyStep, MarketRow, SceneAsideData, StepBlock, StepBlocker } from '@/server/consultant/aside';
import { CONSENT_TEXTS } from '@/server/consent/texts';

import { fieldVisibility } from '../onboarding/OnboardingDraft';
import { useAsideData, useAsideRefresh } from './aside-refresh';
import { FilesCard } from './FilesCard';
import { MemoryCard } from './MemoryCard';
import styles from './SceneAside.module.css';

const STATE_LABEL = { done: 'готово', now: 'сейчас', next: 'дальше' } as const;

/** «Твой путь»: шаги с состоянием; текущий подсвечен, каждый — ссылка на раздел; под шагами — подсказка к текущему. Узкий экран — горизонтальная полоса. */
function Roadmap({ steps, hint }: { steps: JourneyStep[]; hint?: SceneAsideData['hint'] }) {
  return (
    <nav className={styles.road} aria-label="Твой путь">
      <h2 className={styles.title}>Твой путь</h2>
      <ol className={styles.steps}>
        {steps.map((s, i) => (
          <li key={s.id} className={styles.step} data-state={s.state} data-testid={`journey-${s.id}`}>
            <Link href={s.href} className={styles.stepLink} aria-current={s.state === 'now' ? 'step' : undefined} aria-describedby={s.locked ? `journey-lock-${s.id}` : undefined}>
              <span className={styles.marker} aria-hidden="true">
                {s.state === 'done' ? '✓' : i + 1}
              </span>
              <span className={styles.stepText}>
                <span className={styles.stepName}>
                  <span className={styles.full}>{s.label}</span>
                  <span className={styles.short}>{s.short}</span>
                </span>
                <span className={styles.stepNote}>{s.note}</span>
              </span>
              <span className={styles.vh}> — {STATE_LABEL[s.state]}</span>
              {s.locked && <span id={`journey-lock-${s.id}`} role="tooltip" className={styles.lock} data-testid={`journey-lock-${s.id}`}>{s.locked}</span>}
            </Link>
          </li>
        ))}
      </ol>
      {hint && (
        <p className={styles.hint} data-testid="aside-hint">
          <span className={styles.hintTitle}>{hint.title}</span> <span className={styles.hintText}>{hint.text}</span>
        </p>
      )}
    </nav>
  );
}

/** Карточка с заголовком; на узком экране сворачивается (аккордеон), на широком всегда раскрыта. */
function Card({ id, title, className, children }: { id: string; title: string; className?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={`${styles.card} ${className ?? ''}`} data-open={open} data-testid={`aside-${id}`}>
      <h2 className={styles.cardHead}>
        <button type="button" className={styles.cardToggle} aria-expanded={open} aria-controls={`aside-${id}-body`} onClick={() => setOpen((o) => !o)}>
          {title}
          <span className={styles.chevron} aria-hidden="true" />
        </button>
      </h2>
      <div id={`aside-${id}-body`} className={styles.cardBody}>
        {children}
      </div>
    </section>
  );
}

function Docs({ docs }: { docs: AsideDoc[] }) {
  return (
    <Card id="docs" title={`Файлы и ссылки${docs.length ? ` · ${docs.length}` : ''}`}>
      <FilesCard docs={docs} />
    </Card>
  );
}

const MARKET_ROWS = 6;

/** Живые цифры базы: кандидату — активные потребности компаний, работодателю — кандидаты с категорией по тесту. */
function Market({ market, role }: { market: NonNullable<SceneAsideData['market']>; role: SceneAsideData['role'] }) {
  const employer = role === 'employer';
  const rows: MarketRow[] = market.rows.slice(0, MARKET_ROWS);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card id="market" title={`${employer ? 'Кандидаты в базе' : 'Кого ищут компании'} · ${market.total}`}>
      {rows.length === 0 ? (
        <p className={styles.muted}>{employer ? 'Пока никто не прошёл тест на грейд.' : 'Активных вакансий пока нет.'}</p>
      ) : (
        <>
          <ul className={styles.market}>
            {rows.map((r) => (
              <li key={r.key} className={styles.marketRow} data-mine={r.mine || undefined}>
                <span className={styles.marketLabel}>{r.label}</span>
                <span className={styles.bar} aria-hidden="true">
                  <span style={{ width: `${Math.round((r.count / max) * 100)}%` }} />
                </span>
                <span className={styles.marketCount}>{r.count}</span>
              </li>
            ))}
          </ul>
          <p className={styles.marketNote}>
            {employer ? 'Категория у кандидата - только по тесту. Подсвечено то, что совпадает с твоими вакансиями.' : 'Активные вакансии по категориям - по ним выбирай направление теста.'}
          </p>
        </>
      )}
    </Card>
  );
}

/**
 * Знакомство: таймлайн анкеты и цифры. `progress.done` — пройденные вопросы (отвеченные и пропущенные, engine.ts),
 * «ответов сохранено» — только ответы (пропуск ответом не считается), поэтому числа могут отличаться.
 */
function ProfileProgress({ progress, known, role }: { progress: NonNullable<SceneAsideData['onboarding']>; known: SceneAsideData['known']; role: SceneAsideData['role'] }) {
  const answers = (known ?? []).filter((f) => f.source === 'onboarding' && f.stepId);
  const seen = answers.filter((f) => fieldVisibility(f.stepId!) === 'в анонимной карточке').length;
  const left = Math.max(0, progress.total - progress.done);
  return (
    <Card id="progress" title={`Заполнение профиля · ${progress.done} из ${progress.total} ${plural(progress.total, 'вопроса', 'вопросов', 'вопросов')}`}>
      <div className={styles.progressBar} role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total} aria-label={`Пройдено ${progress.done} из ${progress.total} ${plural(progress.total, 'вопроса', 'вопросов', 'вопросов')}`}>
        {Array.from({ length: progress.total }, (_, i) => <i key={i} data-done={i < progress.done || undefined} />)}
      </div>
      <dl className={styles.progressStats}>
        <div><dt>ответов сохранено</dt><dd>{answers.length}</dd></div>
        <div><dt>вопросов осталось</dt><dd>{left}</dd></div>
        {/* публичные поля анонимной карточки есть только у кандидата (fieldVisibility) */}
        {role === 'candidate' && <div><dt>ответов видит компания</dt><dd>{seen}</dd></div>}
      </dl>
      {progress.current && <p className={styles.muted}>Сейчас: {progress.current.toLowerCase()} - вопрос ждёт в чате.</p>}
    </Card>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const invitesWord = (n: number) => `${n} ${plural(n, 'приглашение', 'приглашения', 'приглашений')}`;
const vacanciesWord = (n: number) => `${n} ${plural(n, 'вакансия', 'вакансии', 'вакансий')}`;
const PROJECT_STATUS = { submitted: 'сдан, ждёт проверки', running: 'проверяется', checked: 'проверен', failed: 'проверка не прошла' } as const;

/** Блокер шага: что мешает и как снять. Согласие на оценку ИИ даётся здесь же (POST /api/consents), после — колонка перечитывается. */
function BlockerView({ id, blocker }: { id: string; blocker: StepBlocker }) {
  const refresh = useAsideRefresh();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const grant = async () => {
    setBusy(true);
    setError(null);
    try {
      await grantConsentApi('ai_assessment', CONSENT_TEXTS.ai_assessment.version);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось сохранить согласие');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={styles.blocker} role="status" data-testid={`${id}-blocker`}>
      <p className={styles.blockerText}>{blocker.text}</p>
      {blocker.action === 'grant_ai_assessment' && (
        <button type="button" className={styles.cta} onClick={grant} disabled={busy} data-testid={`${id}-grant`}>
          {busy ? 'Сохраняю…' : 'Дать согласие'}
        </button>
      )}
      {!blocker.action && blocker.href && <Link href={blocker.href} className={styles.cta}>{blocker.href === '/settings' ? 'Открыть настройки' : 'Открыть'}</Link>}
      {error && <p className={styles.blockerError} role="alert">{error}</p>}
    </div>
  );
}

/** Карточка шага: короткий текст и одна кнопка-ссылка; при блокере — сначала он, кнопка шага вторичная (или её нет). */
function StepCard({ id, title, text, extra, href, cta, blocker }: { id: string; title: string; text: string; extra?: string; href?: string; cta?: string; blocker?: StepBlocker }) {
  return (
    <Card id={id} title={title}>
      <p className={styles.muted}>{text}</p>
      {extra && <p className={styles.stepExtra} data-testid={`${id}-extra`}>{extra}</p>}
      {blocker && <BlockerView id={id} blocker={blocker} />}
      {href && cta && <Link href={href} className={blocker ? styles.ctaSecondary : styles.cta} data-testid={`${id}-cta`}>{cta}</Link>}
    </Card>
  );
}

/** Блок под текущий шаг пути кандидата (решение владельца 12.10: панель меняется по шагу). Нет данных — ничего не рисуем. */
function StepBlockView({ block, market, docs, role }: { block: StepBlock; market: SceneAsideData['market']; docs: SceneAsideData['docs']; role: SceneAsideData['role'] }) {
  switch (block.step) {
    case 'onboarding':
      return docs ? <Docs docs={docs} /> : null;
    case 'test':
      return (
        <>
          {!block.demand && market && market.rows.length > 0 && <Market market={market} role={role} />}
          <StepCard
            id="step-test"
            title="Тест на грейд"
            text="Компании ищут по категории, а её даёт только тест: после него ты попадёшь в подборку."
            extra={block.demand ? `Сейчас в направлении ${block.demand.direction}: ${vacanciesWord(block.demand.total)} · ${block.demand.detail}` : undefined}
            href="/test"
            cta="Начать тест" blocker={block.blocker}
          />
        </>
      );
    case 'call':
      return <StepCard id="step-call" title="Созвон с ИИ" text="Короткий голосовой разговор по темам резюме. Итог - карта глубины, работодатель видит её до приглашения." href="/consultant?call=1" cta="Созвониться" blocker={block.blocker} />;
    case 'project': {
      const p = block.project;
      return <StepCard id="step-project" title="Лента заданий" text={block.forLive ? 'Компания ждёт твой проект: без него защиту не назначить. Возьми проект из ленты, сдай репозиторий и дождись проверки.' : 'Возьми проект из ленты, сдай репозиторий и дождись проверки.'} extra={p ? `${p.title}: ${PROJECT_STATUS[p.status]}` : undefined} href={p && p.status !== 'checked' ? `/projects/${p.taskId}` : '/projects'} cta={p && p.status !== 'checked' ? 'Открыть задание' : 'Открыть ленту заданий'} blocker={block.blocker} />;
    }
    case 'ai_defense': {
      const p = block.project;
      if (!p) return null;
      return <StepCard id="step-ai-defense" title="ИИ-защита проекта" text="ИИ задаёт вопросы по коду и коммитам. Нужна запись с согласием; работодатель до приглашения увидит только баллы и флаги." extra={p.title} href={`/projects/${p.taskId}`} cta="Защитить проект с ИИ" blocker={block.blocker} />;
    }
    case 'waiting':
    case 'invitations': {
      const inv = block.invitations;
      if (!inv) return null;
      const text = inv.pending > 0 ? `Ждут ответа: ${invitesWord(inv.pending)}.` : inv.total > 0 ? `Всего: ${invitesWord(inv.total)}.` : 'Приглашений пока нет: компании находят профиль сами.';
      return <StepCard id="step-invitations" title={`Приглашения · ${inv.total}`} text={text} href="/invitations" cta="Открыть приглашения" blocker={block.blocker} />;
    }
    case 'live_defense': {
      const c = liveStepCopy(block.live);
      return <StepCard id="step-live" title="Живая защита" text={c.text} extra={block.live?.company} href={c.cta?.href} cta={c.cta?.label} blocker={block.blocker} />;
    }
    case 'hired':
      return block.hired ? <StepCard id="step-hired" title="Нанят" text={`Компания отметила найм: ${block.hired.company}.`} href="/invitations" cta="Открыть приглашения" /> : null;
  }
}

/** Правая колонка под головой: роадмап с подсказкой по текущему шагу, что уже известно, рынок, документы (кандидат). */
export function SceneAside({ data: initial, className }: { data: SceneAsideData; className?: string }) {
  const data = useAsideData() ?? initial;
  if (data.onboarding)
    return (
      <div className={`${styles.box} ${className ?? ''}`} data-testid="scene-aside">
        <div className={styles.aside} data-role={data.role} data-mode="onboarding">
          <ProfileProgress progress={data.onboarding} known={data.known} role={data.role} />
          <MemoryCard facts={data.known ?? []} role={data.role} pending={data.memoryPending} fill={data.fill} minimal />
        </div>
      </div>
    );
  return (
    // внешний блок — контейнер размера (@container aside), внутренний — сетка: запрос не стилизует сам контейнер
    <div className={`${styles.box} ${className ?? ''}`} data-testid="scene-aside">
      <div className={styles.aside} data-role={data.role}>
        {/* путь → главное действие шага → память; подсказка под путём только без блока шага (иначе тот же текст трижды) */}
        <Roadmap steps={data.steps} hint={data.stepBlock ? undefined : data.hint} />
        {data.stepBlock ? (
          <StepBlockView block={data.stepBlock} market={data.market} docs={data.docs} role={data.role} />
        ) : (
          <>
            {data.market && <Market market={data.market} role={data.role} />}
            {data.docs && <Docs docs={data.docs} />}
          </>
        )}
        <MemoryCard facts={data.known ?? []} role={data.role} pending={data.memoryPending} limit={data.memoryLimit} fill={data.fill} />
      </div>
    </div>
  );
}
