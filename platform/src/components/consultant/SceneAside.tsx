'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { AsideDoc, JourneyStep, SceneAsideData } from '@/server/consultant/aside';

import styles from './SceneAside.module.css';

const STATE_LABEL = { done: 'готово', now: 'сейчас', next: 'дальше' } as const;

/** «Твой путь»: шаги с состоянием; текущий подсвечен, каждый — ссылка на раздел. Узкий экран — горизонтальная полоса. */
function Roadmap({ steps }: { steps: JourneyStep[] }) {
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

/** Правая колонка под головой: роадмап, документы (кандидат) и подсказка по текущему шагу. */
export function SceneAside({ data, className }: { data: SceneAsideData; className?: string }) {
  return (
    <div className={`${styles.aside} ${className ?? ''}`} data-testid="scene-aside" data-solo={data.docs ? undefined : ''}>
      <Roadmap steps={data.steps} />
      {data.docs && <Docs docs={data.docs} />}
      <Card id="hint" title="Подсказка" className={styles.hintCard}>
        <p className={styles.hintTitle}>{data.hint.title}</p>
        <p className={styles.hintText}>{data.hint.text}</p>
      </Card>
    </div>
  );
}
