'use client';

import { useEffect, useState } from 'react';

import { ApiError, request } from '@/lib/api';
import { SPEC_LABEL, subcategoryLabel, type Specialization } from '@/lib/directions';
import { GRADE_LABEL, GRADES, type Grade } from '@/lib/grades';
import type { AttemptView, JuryResult } from '@/server/test/types';

import { useBareShell } from '../shell/ShellFrame';
import { ItemScreen, JuryResultPlate } from '../TestPage';
import styles from '../TestPage.module.css';
import { Button, Chip, Kicker, Notice, Panel, Tag } from '../ui';
import ui from '../ui.module.css';

const API = '/api/expert';

interface Directions {
  directions: { specialization: Specialization; subcategories: { id: string; title: string; available: boolean }[] }[];
}

interface ExpertView {
  attempt: AttemptView;
  outcome: { wouldGrant: Grade | null; heldByIntegrity: boolean; theta: number; se: number; pPass: number } | null;
  jury: JuryResult | null;
}

const post = <T,>(url: string, body?: unknown) =>
  request<T>(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? e.message : fallback;
}

function Intro({ onStart }: { onStart: (spec: Specialization, sub: string, grade: Grade) => Promise<void> }) {
  const [dirs, setDirs] = useState<Directions['directions'] | null>(null);
  const [spec, setSpec] = useState<Specialization | null>(null);
  const [sub, setSub] = useState<string | null>(null);
  const [grade, setGrade] = useState<Grade>('middle');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    request<Directions>(`${API}/start`).then(
      (d) => {
        const open = d.directions.filter((x) => x.subcategories.some((s) => s.available));
        setDirs(open);
        const first = open[0];
        if (first) {
          setSpec(first.specialization);
          setSub(first.subcategories.find((s) => s.available)?.id ?? null);
        }
      },
      (e) => setError(errorText(e, 'Не удалось загрузить направления.')),
    );
  }, []);

  const current = dirs?.find((d) => d.specialization === spec);

  async function start() {
    if (!spec || !sub) return;
    setPending(true);
    setError(null);
    try {
      await onStart(spec, sub, grade);
    } catch (e) {
      setError(errorText(e, 'Не удалось начать тест.'));
      setPending(false);
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <Kicker>Режим эксперта · для жюри</Kicker>
        <h1 className={styles.h1}>Пройдите тест на грейд сами</h1>
        <ul className={styles.lead} data-testid="expert-about">
          <li>Это тот же адаптивный тест, что у кандидата: те же задания, IRT-оценка, остановка и индекс честности.</li>
          <li>Без регистрации: грейд и категория никому не присваиваются, в подборку и поиск работодателя вы не попадаете.</li>
          <li>В конце - разбор: грейд по ответам, θ̂ ± SE, задания с ключами и что заметил индекс честности.</li>
        </ul>
      </div>

      <Panel as="section" aria-label="Направление и грейд" className={styles.choice}>
        <div className={styles.choiceRow}>
          <span className={ui.label}>Направление</span>
          <div className={styles.chips} role="group" aria-label="Направление">
            {(dirs ?? []).map((d) => (
              <Chip
                key={d.specialization}
                pressed={spec === d.specialization}
                disabled={pending}
                onClick={() => {
                  setSpec(d.specialization);
                  setSub(d.subcategories.find((s) => s.available)?.id ?? null);
                }}
              >
                {SPEC_LABEL[d.specialization]}
              </Chip>
            ))}
          </div>
        </div>
        <div className={styles.choiceRow}>
          <span className={ui.label}>Подкатегория (тест - по её заданиям)</span>
          <div className={styles.chips} role="group" aria-label="Подкатегория">
            {(current?.subcategories ?? []).filter((s) => s.available).map((s) => (
              <Chip key={s.id} pressed={sub === s.id} disabled={pending} onClick={() => setSub(s.id)}>
                {s.title}
              </Chip>
            ))}
          </div>
        </div>
        <div className={styles.choiceRow}>
          <span className={ui.label}>Грейд, который проверяем</span>
          <div className={styles.chips} role="group" aria-label="Грейд">
            {GRADES.map((g) => (
              <Chip key={g} pressed={grade === g} disabled={pending} onClick={() => setGrade(g)}>
                {GRADE_LABEL[g]}
              </Chip>
            ))}
          </div>
        </div>
      </Panel>

      {error && <Notice tone="error">{error}</Notice>}
      <div className={styles.actions}>
        <Button variant="cta" onClick={() => void start()} loading={pending} disabled={!spec || !sub} data-testid="expert-start">
          Начать тест эксперта
        </Button>
      </div>
      <p className={ui.muted} style={{ fontSize: 'var(--fs-sm)' }}>
        Нажимая кнопку, вы соглашаетесь на автоматическую оценку ответов. Персональные данные не собираются; запись теста удаляется через сутки.
      </p>
    </div>
  );
}

function Review({ view, onRetry }: { view: ExpertView; onRetry: () => void }) {
  const { attempt, outcome, jury } = view;
  const r = attempt.result!;
  const [showItems, setShowItems] = useState(true);
  const claimed = GRADE_LABEL[attempt.grade];
  const verdict =
    r.status === 'abandoned'
      ? 'Попытка без ответов - итога нет'
      : outcome?.wouldGrant
        ? `По ответам: ${GRADE_LABEL[outcome.wouldGrant]}`
        : `По ответам ${claimed} не подтверждается`;
  return (
    <div className={styles.page}>
      <div>
        <Kicker>
          Разбор эксперта · {SPEC_LABEL[attempt.specialization]}
          {attempt.subcategoryId ? ` · ${subcategoryLabel(attempt.subcategoryId)}` : ''} · заявлен {claimed}
        </Kicker>
        <h1 className={styles.h1} data-testid="expert-verdict">
          {verdict}
        </h1>
      </div>

      <Panel as="section" variant="strong" className={styles.result} aria-label="Итог">
        <div className={styles.resultHead}>
          <Tag tone="outline">грейд не присвоен - режим эксперта</Tag>
          <span className={styles.big}>
            {r.correct} из {r.answered}
          </span>
        </div>
        {outcome && r.status !== 'abandoned' && (
          <dl className={styles.facts}>
            <div>
              <dt>θ̂ ± SE</dt>
              <dd data-testid="expert-theta">
                {outcome.theta.toFixed(2)} ± {outcome.se.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt>P(уровень ≥ {claimed})</dt>
              <dd>{Math.round(outcome.pPass * 100)}%</dd>
            </div>
            <div>
              <dt>Заданий</dt>
              <dd>{r.answered}</dd>
            </div>
          </dl>
        )}
        <p className={styles.explanation}>{r.explanation}</p>
        {outcome?.heldByIntegrity && (
          <Notice data-testid="expert-held">
            У кандидата выдача грейда была бы задержана индексом честности: ему предложили бы короткий подтверждающий тест.
          </Notice>
        )}
        {outcome?.wouldGrant && !r.confirmed && !outcome.heldByIntegrity && (
          <p className={ui.muted}>Кандидату грейд ниже заявленного выдаётся только по его согласию, в один клик.</p>
        )}
      </Panel>

      {jury ? <JuryResultPlate jury={jury} /> : <p className={ui.muted}>Индекс честности по этой попытке не считался.</p>}

      <div className={styles.actions}>
        <Button variant="primary" onClick={onRetry} data-testid="expert-retry">
          Пройти ещё раз
        </Button>
        <Button size="sm" onClick={() => setShowItems((v) => !v)} aria-expanded={showItems}>
          {showItems ? 'Скрыть задания' : 'Задания и ключи'}
        </Button>
      </div>

      {showItems && (
        <ol className={styles.review} aria-label="Задания попытки" data-testid="expert-items">
          {r.items.map((it) => (
            <li key={it.index} className={`${ui.panel} ${styles.reviewItem}`}>
              <div className={styles.reviewHead}>
                <b>
                  {it.index + 1}. {it.title}
                </b>
                <Tag tone={it.correct ? 'solid' : 'dashed'}>{it.correct ? 'верно' : 'неверно'}</Tag>
              </div>
              <p className={ui.muted}>
                Ваш ответ: {it.answer || '-'} · верный: {it.answerKey} · лимит {it.timeLimitSec} с
              </p>
              <p>{it.explanation}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Режим эксперта (/expert): настоящий тест на грейд тем же UI задания, итог - разбор для жюри. Категория не присваивается. */
export function ExpertTest() {
  const [view, setView] = useState<ExpertView | null>(null);
  const [error, setError] = useState<string | null>(null);
  useBareShell(view?.attempt.status === 'active');

  async function start(spec: Specialization, sub: string, grade: Grade) {
    const s = await post<{ attemptId: string }>(`${API}/start`, { specialization: spec, subcategoryId: sub, grade });
    setView(await request<ExpertView>(`${API}/attempt/${encodeURIComponent(s.attemptId)}`));
  }

  if (error) {
    return (
      <div className={styles.page}>
        <Notice tone="error">{error}</Notice>
        <Button size="sm" onClick={() => { setError(null); setView(null); }} style={{ justifySelf: 'start' }}>
          Начать заново
        </Button>
      </div>
    );
  }
  if (!view) return <Intro onStart={start} />;
  const a = view.attempt;
  if (a.status === 'active' && a.current) {
    return (
      <ItemScreen
        attempt={a}
        apiBase={API}
        onAnswer={async (answer) => setView(await post<ExpertView>(`${API}/attempt/${encodeURIComponent(a.id)}/answer`, { answer }))}
        onFinish={async () => {
          try {
            setView(await post<ExpertView>(`${API}/attempt/${encodeURIComponent(a.id)}/finish`));
          } catch (e) {
            setError(errorText(e, 'Не удалось завершить тест.'));
          }
        }}
      />
    );
  }
  if (a.result) return <Review view={view} onRetry={() => setView(null)} />;
  return (
    <div className={styles.page}>
      <Notice>Попытка в неожиданном состоянии.</Notice>
      <Button size="sm" onClick={() => setView(null)} style={{ justifySelf: 'start' }}>
        Начать заново
      </Button>
    </div>
  );
}
