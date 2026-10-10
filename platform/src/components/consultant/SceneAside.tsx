'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { AsideDoc, JourneyStep, KnownFact, MarketRow, SceneAsideData } from '@/server/consultant/aside';

import { useAsideData } from './aside-refresh';
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

/** Прикрепить: открывает выбор файла в композере ленты (кнопка-скрепка), иначе ставит фокус в поле ввода. */
function attach() {
  const feed = document.querySelector('[data-feed-scroll]');
  const btn = feed?.querySelector<HTMLButtonElement>('button[aria-label="Прикрепить файл"]');
  if (btn && !btn.disabled) btn.click();
  else feed?.querySelector<HTMLElement>('textarea, input[type="text"]')?.focus();
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
    <Card id="docs" title={`Документы${docs.length ? ` · ${docs.length}` : ''}`}>
      {docs.length === 0 ? (
        <div className={styles.empty}>
          <p>Пока ничего не загружено. Резюме, диплом или ссылка на GitHub - из них консультант достанет утверждения для профиля.</p>
          <button type="button" className={styles.attach} onClick={attach}>
            Прикрепить
          </button>
        </div>
      ) : (
        <ul className={styles.docs}>
          {docs.map((d) => (
            <li key={d.id} className={styles.doc}>
              <span className={styles.docKind} aria-hidden="true">
                {d.kind === 'file' ? 'файл' : 'ссылка'}
              </span>
              <span className={styles.docName} title={d.name}>
                {d.name}
              </span>
              <span className={styles.docStatus}>{d.status}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Что консультант уже узнал в знакомстве: короткое имя шага и ответ; меняется прямо в ленте. */
function Known({ facts, role }: { facts: KnownFact[]; role: SceneAsideData['role'] }) {
  return (
    <Card id="known" title={`${role === 'employer' ? 'Что я знаю о компании' : 'Что я о тебе знаю'}${facts.length ? ` · ${facts.length}` : ''}`}>
      {facts.length === 0 ? (
        <p className={styles.muted}>Пока ничего. Отвечай в чате слева - ответы появятся здесь, и консультант будет на них опираться.</p>
      ) : (
        <dl className={styles.facts}>
          {facts.map((f) => (
            <div key={f.stepId} className={styles.fact}>
              <dt>{f.label}</dt>
              <dd title={f.value}>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
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
        <p className={styles.muted}>{employer ? 'Пока никто не прошёл тест на грейд.' : 'Активных потребностей пока нет.'}</p>
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
            {employer ? 'Категория у кандидата - только по тесту. Подсвечено то, что совпадает с твоими потребностями.' : 'Активные потребности компаний по категориям. Подсвечена твоя категория по тесту.'}
          </p>
        </>
      )}
    </Card>
  );
}

/** Правая колонка под головой: роадмап с подсказкой по текущему шагу, что уже известно, рынок, документы (кандидат). */
export function SceneAside({ data: initial, className }: { data: SceneAsideData; className?: string }) {
  const data = useAsideData() ?? initial;
  return (
    <div className={`${styles.aside} ${className ?? ''}`} data-testid="scene-aside">
      <Roadmap steps={data.steps} hint={data.hint} />
      <Known facts={data.known ?? []} role={data.role} />
      {data.market && <Market market={data.market} role={data.role} />}
      {data.docs && <Docs docs={data.docs} />}
      {data.role === 'candidate' && (
        <Card id="instructions" title="Как мне работать">
          <InstructionsCard initial={data.instructions} />
        </Card>
      )}
    </div>
  );
}
