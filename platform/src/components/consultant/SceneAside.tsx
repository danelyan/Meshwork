'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { AsideDoc, JourneyStep, MarketRow, SceneAsideData, StepBlock } from '@/server/consultant/aside';

import { fieldVisibility } from '../onboarding/OnboardingDraft';
import { useAsideData } from './aside-refresh';
import { FilesCard } from './FilesCard';
import { MemoryCard } from './MemoryCard';
import styles from './SceneAside.module.css';

const STATE_LABEL = { done: 'готово', now: 'сейчас', next: 'дальше' } as const;

/** «Твой путь»: шаги с состоянием; текущий подсвечен, каждый — ссылка на раздел; под шагами — подсказка к текущему. Узкий экран — горизонтальная полоса. */
function Roadmap({ steps, hint }: { steps: JourneyStep[]; hint: SceneAsideData['hint'] }) {
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
      <p className={styles.hint} data-testid="aside-hint">
        <span className={styles.hintTitle}>{hint.title}</span> <span className={styles.hintText}>{hint.text}</span>
      </p>
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
            {employer ? 'Категория у кандидата - только по тесту. Подсвечено то, что совпадает с твоими вакансиями.' : 'Активные вакансии компаний по категориям. Подсвечена твоя категория по тесту.'}
          </p>
        </>
      )}
    </Card>
  );
}

/** Знакомство: таймлайн заполнения анкеты и цифры — сколько сохранено, что увидит компания. */
function ProfileProgress({ progress, known }: { progress: NonNullable<SceneAsideData['onboarding']>; known: SceneAsideData['known'] }) {
  const answers = (known ?? []).filter((f) => f.source === 'onboarding' && f.stepId);
  const seen = answers.filter((f) => fieldVisibility(f.stepId!) === 'в анонимной карточке').length;
  const left = Math.max(0, progress.total - progress.done);
  return (
    <Card id="progress" title={`Заполнение профиля · ${progress.done} из ${progress.total}`}>
      <div className={styles.progressBar} role="progressbar" aria-valuenow={progress.done} aria-valuemin={0} aria-valuemax={progress.total} aria-label={`Заполнено ${progress.done} из ${progress.total}`}>
        {Array.from({ length: progress.total }, (_, i) => <i key={i} data-done={i < progress.done || undefined} />)}
      </div>
      <dl className={styles.progressStats}>
        <div><dt>сохранено</dt><dd>{progress.done}</dd></div>
        <div><dt>осталось</dt><dd>{left}</dd></div>
        <div><dt>видит компания</dt><dd>{seen}</dd></div>
      </dl>
      {progress.current && <p className={styles.muted}>Сейчас: {progress.current.toLowerCase()} - вопрос в чате слева.</p>}
    </Card>
  );
}

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10;
  const m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};
const invitesWord = (n: number) => `${n} ${plural(n, 'приглашение', 'приглашения', 'приглашений')}`;
const PROJECT_STATUS = { submitted: 'сдан, ждёт проверки', running: 'проверяется', checked: 'проверен', failed: 'проверка не прошла' } as const;

/** Карточка шага: короткий текст и одна кнопка-ссылка. */
function StepCard({ id, title, text, extra, href, cta }: { id: string; title: string; text: string; extra?: string; href: string; cta: string }) {
  return (
    <Card id={id} title={title}>
      <p className={styles.muted}>{text}</p>
      {extra && <p className={styles.stepExtra} data-testid={`${id}-extra`}>{extra}</p>}
      <Link href={href} className={styles.cta}>{cta}</Link>
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
          {market && market.rows.length > 0 && <Market market={market} role={role} />}
          <StepCard id="step-test" title="Тест на грейд" text="Категорию даёт только тест: после него компании найдут тебя в подборке." href="/test" cta="Начать тест" />
        </>
      );
    case 'call':
      return <StepCard id="step-call" title="Созвон с ИИ" text="Короткий голосовой разговор по темам резюме. Итог - карта глубины, работодатель видит её до приглашения." href="/consultant?call=1" cta="Созвониться" />;
    case 'project': {
      const p = block.project;
      return <StepCard id="step-project" title="Лента заданий" text="Возьми проект из ленты, сдай репозиторий и дождись проверки." extra={p ? `${p.title}: ${PROJECT_STATUS[p.status]}` : undefined} href={p && p.status !== 'checked' ? `/projects/${p.taskId}` : '/projects'} cta={p && p.status !== 'checked' ? 'Открыть задание' : 'Открыть ленту заданий'} />;
    }
    case 'ai_defense': {
      const p = block.project;
      if (!p) return null;
      return <StepCard id="step-ai-defense" title="ИИ-защита проекта" text="ИИ задаёт вопросы по коду и коммитам. Нужна запись с согласием; работодатель до приглашения увидит только баллы и флаги." extra={p.title} href={`/projects/${p.taskId}`} cta="Защитить проект с ИИ" />;
    }
    case 'waiting':
    case 'invitations': {
      const inv = block.invitations;
      if (!inv) return null;
      const text = inv.pending > 0 ? `Ждут ответа: ${invitesWord(inv.pending)}.` : inv.total > 0 ? `Всего: ${invitesWord(inv.total)}.` : 'Приглашений пока нет: компании находят профиль сами.';
      return <StepCard id="step-invitations" title={`Приглашения · ${inv.total}`} text={text} href="/invitations" cta="Открыть приглашения" />;
    }
    case 'live_defense':
      return <StepCard id="step-live" title="Живая защита" text="Приглашение принято: работодатель предложит слоты, ты выберешь время. Защита идёт с записью." href="/invitations" cta="Выбрать слот" />;
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
          <ProfileProgress progress={data.onboarding} known={data.known} />
          <MemoryCard facts={data.known ?? []} role={data.role} pending={data.memoryPending} fill={data.fill} minimal />
        </div>
      </div>
    );
  return (
    // внешний блок — контейнер размера (@container aside), внутренний — сетка: запрос не стилизует сам контейнер
    <div className={`${styles.box} ${className ?? ''}`} data-testid="scene-aside">
      <div className={styles.aside} data-role={data.role}>
        <Roadmap steps={data.steps} hint={data.hint} />
        <MemoryCard facts={data.known ?? []} role={data.role} pending={data.memoryPending} limit={data.memoryLimit} fill={data.fill} />
        {data.stepBlock ? (
          <StepBlockView block={data.stepBlock} market={data.market} docs={data.docs} role={data.role} />
        ) : (
          <>
            {data.market && <Market market={data.market} role={data.role} />}
            {data.docs && <Docs docs={data.docs} />}
          </>
        )}
      </div>
    </div>
  );
}
