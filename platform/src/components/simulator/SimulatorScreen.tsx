'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { Container } from '@/components/shell/Container';
import { PageTitle } from '@/components/shell/PageTitle';
import { Button, Field, Notice, Panel, Tag } from '@/components/ui';
import { GRADE_LABEL, GRADES, type Grade } from '@/lib/grades';
import type { SimMode, SimResult, SimSubcategory } from '@/server/validation/simulator';

import { dec, pct } from '../validation/format';

import styles from './Simulator.module.css';
import { ThetaChart } from './ThetaChart';

export const MODE_LABEL: Record<SimMode, string> = {
  ideal: 'Идеальный: ответы строго по модели IRT',
  noise: 'С шумом: сложность каждого показа ±0,2',
  leak: 'С утечкой приёмов: знает трюк по 30 % семейств',
};

export const STOP_LABEL: Record<SimResult['stopReason'], string> = {
  confident: 'уверенное решение по порогу грейда',
  precise: 'достигнута нужная точность оценки',
  max_items: 'достигнут предел заданий',
  junior_resolved: 'дозадавание Junior дало уверенный ответ',
  middle_resolved: 'дозадавание Middle дало уверенный ответ',
  pool_end: 'задания пула закончились',
};

const PHASE_LABEL = { main: 'основная', junior_probe: 'дозадавание Junior', middle_probe: 'дозадавание Middle' } as const;

export interface SimulatorProps {
  subcategories: SimSubcategory[];
  cuts: Record<Grade, number>;
  initial: SimResult | null;
  limits: { thetaMin: number; thetaMax: number; seedMax: number };
  confirmProb: number;
}

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `Сервер ответил ${res.status}`;
}

/** Где на шкале θ лежит значение: подпись зоны по порогам грейдов. */
export function zoneOf(theta: number, cuts: Record<Grade, number>): string {
  if (theta > cuts.senior) return 'зона Senior';
  if (theta > cuts.middle) return 'зона Middle';
  if (theta > cuts.junior) return 'зона Junior';
  return 'ниже Junior';
}

function outcomeText(r: SimResult): string {
  if (r.confirmed) return `${GRADE_LABEL[r.input.claimed]} подтверждён`;
  if (r.offeredGrade) return `${GRADE_LABEL[r.input.claimed]} не подтверждён, предложен ${GRADE_LABEL[r.offeredGrade]}`;
  return `${GRADE_LABEL[r.input.claimed]} не подтверждён`;
}

export function SimulatorScreen({ subcategories, cuts, initial, limits, confirmProb }: SimulatorProps) {
  const first = initial?.input;
  const [subcategoryId, setSub] = useState(first?.subcategoryId ?? subcategories[0]?.id ?? '');
  const [claimed, setClaimed] = useState<Grade>(first?.claimed ?? 'middle');
  const [theta, setTheta] = useState(first?.theta ?? 0.3);
  const [mode, setMode] = useState<SimMode>(first?.mode ?? 'ideal');
  const [seed, setSeed] = useState(String(first?.seed ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SimResult | null>(initial);

  const run = async (e?: FormEvent, overrideSeed?: number) => {
    e?.preventDefault();
    setError(null);
    const seedNum = overrideSeed ?? Number(seed);
    if (!Number.isInteger(seedNum) || seedNum < 0 || seedNum > limits.seedMax) {
      setError(`Seed - целое от 0 до ${limits.seedMax}`);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/simulator', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subcategoryId, claimed, theta, mode, seed: seedNum }) });
      if (!res.ok) {
        setError(await errorText(res));
        return;
      }
      setResult((await res.json()) as SimResult);
    } catch {
      setError('Сеть недоступна, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const reseed = () => {
    const next = Math.floor(Math.random() * 1_000_000);
    setSeed(String(next));
    void run(undefined, next);
  };

  const bySpec = new Map<string, SimSubcategory[]>();
  for (const s of subcategories) bySpec.set(s.specializationTitle, [...(bySpec.get(s.specializationTitle) ?? []), s]);

  return (
    <main id="main">
      <Container size="default" className={styles.page}>
        <PageTitle
          kicker="Валидация"
          title="Симулятор адаптивного теста"
          lead="Задайте виртуального кандидата: направление, «истинный» уровень и заявленный грейд. Сервер прогонит его через тот же движок, что и боевой тест, и покажет, как задания выбираются, как меняется оценка θ и как выносится грейд."
        />

        <Panel as="form" className={styles.form} onSubmit={run} aria-label="Виртуальный кандидат">
          <div className={styles.row}>
            <Field label="Направление и подкатегория">
              <select className={styles.select} value={subcategoryId} onChange={(e) => setSub(e.target.value)}>
                {[...bySpec.entries()].map(([spec, subs]) => (
                  <optgroup key={spec} label={spec}>
                    {subs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
            <Field label="Заявленный грейд">
              <select className={styles.select} value={claimed} onChange={(e) => setClaimed(e.target.value as Grade)}>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {GRADE_LABEL[g]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Режим ответов">
              <select className={styles.select} value={mode} onChange={(e) => setMode(e.target.value as SimMode)}>
                {(Object.keys(MODE_LABEL) as SimMode[]).map((m) => (
                  <option key={m} value={m}>
                    {MODE_LABEL[m]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Seed" hint={`Целое от 0 до ${limits.seedMax}: тот же seed - тот же прогон`}>
              <input className={styles.number} type="number" inputMode="numeric" min={0} max={limits.seedMax} step={1} value={seed} onChange={(e) => setSeed(e.target.value)} />
            </Field>
          </div>

          <Field label={`Истинный уровень θ: ${dec(theta, 1)} (${zoneOf(theta, cuts)})`} hint="Чем выше θ, тем вероятнее верный ответ на любое задание. Пороги грейдов - на шкале ниже.">
            <input className={styles.slider} type="range" min={limits.thetaMin} max={limits.thetaMax} step={0.1} value={theta} onChange={(e) => setTheta(Number(e.target.value))} />
          </Field>
          <div className={styles.marks} aria-hidden="true">
            <span>{limits.thetaMin}</span>
            <span>Junior &gt; {dec(cuts.junior, 1)}</span>
            <span>Middle &gt; {dec(cuts.middle, 1)}</span>
            <span>Senior &gt; {dec(cuts.senior, 1)}</span>
            <span>{limits.thetaMax}</span>
          </div>

          <div className={styles.actions}>
            <Button type="submit" variant="cta" loading={busy} disabled={!subcategoryId}>
              Прогнать тест
            </Button>
            <Button type="button" variant="ghost" onClick={reseed} disabled={busy || !subcategoryId}>
              Другой seed
            </Button>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </Panel>

        {result && <Result result={result} confirmProb={confirmProb} />}

        <section className={styles.section} aria-labelledby="sim-about">
          <h2 id="sim-about">Что это</h2>
          <ul className={styles.list}>
            <li>Это симуляция по модели, а не реальный кандидат: ответы порождает логистическая модель IRT с параметрами, которые заданы экспертно и на людях не откалиброваны.</li>
            <li>Движок тот же, что в боевом тесте: выбор задания по информации Фишера, оценка θ по сетке, остановка и дозадавание по политике {result?.policyVersion ?? 'текущей версии'}. Здесь нет БД, нейросети и проверки честности.</li>
            <li>Режимы «с шумом» и «с утечкой» повторяют допущения нашей валидации; угадывания в модели нет, поэтому такого режима нет.</li>
            <li>Один прогон - один случайный путь. Как ведёт себя тест на тысячах кандидатов, видно в цифрах валидации.</li>
          </ul>
          <div className={styles.links}>
            <Link href="/validation">Цифры на 2000 синтетических кандидатах</Link>
            <span aria-hidden="true">·</span>
            <span>ADR-0002 теста на грейд: docs/decisions/0002-grade-test.md в репозитории</span>
          </div>
        </section>
      </Container>
    </main>
  );
}

function Result({ result: r, confirmProb }: { result: SimResult; confirmProb: number }) {
  return (
    <>
      <section className={styles.section} aria-labelledby="sim-result">
        <h2 id="sim-result">Итог</h2>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>{r.grade ? GRADE_LABEL[r.grade] : 'нет грейда'}</span>
            <span className={styles.statLabel}>{outcomeText(r)}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{r.length}</span>
            <span className={styles.statLabel}>заданий, верно {r.correctCount}</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>
              {dec(r.theta, 2)} ± {dec(r.se, 2)}
            </span>
            <span className={styles.statLabel}>итоговая θ̂ ± SE (истина {dec(r.input.theta, 1)})</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>{pct(r.pPass)}</span>
            <span className={styles.statLabel}>P(θ выше порога {GRADE_LABEL[r.input.claimed]}), нужно ≥ {Math.round(confirmProb * 100)} %</span>
          </div>
        </div>
        <p className={styles.soft}>Причина остановки: {STOP_LABEL[r.stopReason]}.</p>
      </section>

      <section className={styles.section} aria-labelledby="sim-chart">
        <h2 id="sim-chart">Оценка θ по шагам</h2>
        <ThetaChart result={r} />
        <p className={styles.legend}>Линия - θ̂ после каждого ответа, полоса - ±SE. Закрашенная точка - верный ответ, пустая - неверный. Пунктир с подписью - порог грейда, красный пунктир - истинная θ кандидата.</p>
      </section>

      <section className={styles.section} aria-labelledby="sim-steps">
        <h2 id="sim-steps">Шаги теста</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.num}>№</th>
                <th>Семейство</th>
                <th>Фаза</th>
                <th className={styles.num}>b</th>
                <th className={styles.num}>a</th>
                <th>Ответ</th>
                <th className={styles.num}>θ̂</th>
                <th className={styles.num}>SE</th>
              </tr>
            </thead>
            <tbody>
              {r.steps.map((s) => (
                <tr key={s.n}>
                  <td className={styles.num}>{s.n}</td>
                  <td>
                    {s.title} <Tag>{GRADE_LABEL[s.itemGrade]}</Tag>
                    <div className={styles.mono}>{s.templateId}</div>
                  </td>
                  <td>{PHASE_LABEL[s.phase]}</td>
                  <td className={styles.num}>{dec(s.b, 2)}</td>
                  <td className={styles.num}>{dec(s.a, 2)}</td>
                  <td className={s.correct ? styles.hit : styles.miss}>{s.correct ? 'верно' : 'неверно'}</td>
                  <td className={styles.num}>{dec(s.theta, 2)}</td>
                  <td className={styles.num}>{dec(s.se, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
