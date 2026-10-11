'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { AsideDoc, JourneyStep, MarketRow, SceneAsideData } from '@/server/consultant/aside';

import { fieldVisibility } from '../onboarding/OnboardingDraft';
import { useAsideData } from './aside-refresh';
import { FilesCard } from './FilesCard';
import { MemoryCard } from './MemoryCard';
import { InstructionsCard } from './InstructionsCard';
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
            <Link href={s.href} className={styles.stepLink} aria-current={s.state === 'now' ? 'step' : undefined}>
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
        {data.market && <Market market={data.market} role={data.role} />}
        {data.docs && <Docs docs={data.docs} />}
        {data.role === 'candidate' && (
          <Card id="instructions" title="Как мне работать">
            <InstructionsCard initial={data.instructions} />
          </Card>
        )}
      </div>
    </div>
  );
}
