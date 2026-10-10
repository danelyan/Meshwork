'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';

import { Container } from '@/components/shell/Container';
import { PageTitle } from '@/components/shell/PageTitle';
import { Button, Field, Notice, Panel, Tag } from '@/components/ui';
import type { EVAL_LIMITS, EvaluateInput, EvaluateReport, Metrics } from '@/server/validation/evaluate';

import { dec } from './format';
import styles from './Validation.module.css';

export interface CatalogItem {
  id: string;
  statement: string;
  specialization: string;
}

const REL_LABEL = ['не подходит', 'частично', 'подходит'] as const;

function MetricsCells({ m }: { m: Metrics }) {
  return (
    <>
      <td className={styles.num}>{dec(m.precision)}</td>
      <td className={styles.num}>{dec(m.ndcg)}</td>
      <td className={styles.num}>{dec(m.mrr)}</td>
    </>
  );
}

/** Ответ API → текст ошибки для человека. */
async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `Сервер ответил ${res.status}`;
}

/**
 * /evaluate: вставить или загрузить JSON набора → POST /api/evaluate → метрики нашего ранжирования и базовой линии
 * по каждой вакансии и в среднем, топ с объяснениями. Текст из входа выводится только как текст (React экранирует).
 */
export function EvaluateScreen({ sample, catalog, limits }: { sample: EvaluateInput; catalog: CatalogItem[]; limits: typeof EVAL_LIMITS }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<EvaluateReport | null>(null);

  const loadSample = () => {
    setText(JSON.stringify(sample, null, 2));
    setError(null);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > limits.bodyBytes) {
      setError(`Файл больше ${Math.round(limits.bodyBytes / 1024)} КБ`);
      return;
    }
    setText(await file.text());
    setError(null);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      setError('Это не JSON: проверьте скобки и кавычки');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/evaluate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        setReport(null);
        setError(await errorText(res));
        return;
      }
      setReport((await res.json()) as EvaluateReport);
    } catch {
      setError('Сеть недоступна, попробуйте ещё раз');
    } finally {
      setBusy(false);
    }
  };

  const k = report?.k ?? 5;
  return (
    <main id="main">
      <Container size="default" className={styles.page}>
        <PageTitle
          kicker="Валидация"
          title="Проверить подбор на своих данных"
          lead="Вставьте вакансии, кандидатов и свою разметку релевантности. Сервер прогонит то же ранжирование, что в кабинете работодателя, и посчитает P@k, nDCG@k и MRR рядом с базовой линией. Ничего не сохраняется."
        />

        <Panel as="form" className={styles.form} onSubmit={submit} aria-label="Набор для проверки">
          <Field
            label="Набор в JSON"
            hint={`До ${Math.round(limits.bodyBytes / 1024)} КБ, ${limits.vacancies} вакансий, ${limits.candidates} кандидатов; k от 1 до ${limits.kMax}. Формат — как в примере.`}
          >
            <textarea className={styles.textarea} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder='{"k": 5, "vacancies": [...], "candidates": [...], "relevance": {...}}' />
          </Field>
          <div className={styles.actions}>
            <Button type="submit" variant="cta" loading={busy} disabled={!text.trim()}>
              Посчитать метрики
            </Button>
            <Button type="button" variant="ghost" onClick={loadSample}>
              Загрузить пример
            </Button>
            <label className={styles.file}>
              Или файл .json: <input type="file" accept="application/json,.json" onChange={onFile} />
            </label>
          </div>
          {error && <Notice tone="error">{error}</Notice>}
        </Panel>

        {report && (
          <section className={styles.section} aria-labelledby="result">
            <h2 id="result">Результат</h2>
            <p className={styles.soft}>
              {report.candidates} кандидатов × {report.vacancies} вакансий, k = {report.k}. В среднее вошли {report.scored} вакансий с хотя бы одним
              релевантным.
            </p>
            {report.warnings.map((w) => (
              <Notice key={w}>{w}</Notice>
            ))}
            {report.mean && (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Среднее</th>
                      <th className={styles.num}>P@{k}</th>
                      <th className={styles.num}>nDCG@{k}</th>
                      <th className={styles.num}>MRR</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Наш подбор (потолок P@{k} {dec(report.mean.precisionCeiling)})</td>
                      <MetricsCells m={report.mean.ours} />
                    </tr>
                    <tr>
                      <td>Базовая линия</td>
                      <MetricsCells m={report.mean.baseline} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {report.rows.map((r) => (
              <Panel as="article" key={r.id} className={styles.vacancy}>
                <div className={styles.vacancyHead}>
                  <h3>{r.title ?? r.id}</h3>
                  <span className={styles.mono}>
                    {r.id} · {r.specialization} · {r.grade}
                  </span>
                </div>
                <div className={styles.tableWrap}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Метод</th>
                        <th className={styles.num}>P@{k}</th>
                        <th className={styles.num}>nDCG@{k}</th>
                        <th className={styles.num}>MRR</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>Наш подбор (показано {r.shown}, потолок P@{k} {dec(r.precisionCeiling)})</td>
                        <MetricsCells m={r.ours} />
                      </tr>
                      <tr>
                        <td>Базовая линия</td>
                        <MetricsCells m={r.baseline} />
                      </tr>
                    </tbody>
                  </table>
                </div>
                {r.top.length ? (
                  <ol className={styles.top} aria-label={`Топ-${k} нашего подбора`}>
                    {r.top.map((t) => (
                      <li key={t.candidateId}>
                        <span className={styles.mono}>{t.candidateId}</span> <Tag tone={t.relevance > 0 ? 'solid' : 'dashed'}>{REL_LABEL[t.relevance] ?? t.relevance}</Tag>{' '}
                        <span className={styles.mono}>балл {dec(t.score)}</span>
                        <span className={styles.topSummary}>{t.summary}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.soft}>Наш подбор никого не показал: никто не закрыл требований и ни у кого не совпала категория.</p>
                )}
                <p className={styles.soft}>
                  Базовая линия, топ-{k}: <span className={styles.mono}>{r.baselineTop.join(', ') || '—'}</span>
                </p>
              </Panel>
            ))}
          </section>
        )}

        <section className={styles.section} aria-labelledby="format">
          <h2 id="format">Формат набора</h2>
          <ul className={styles.list}>
            <li>
              <b>vacancies</b> — id, title, specialization (backend, frontend, ai, engineering), grade (junior, middle, senior), needs — требования из каталога
              утверждений с весом 1–3, необязательно stack.
            </li>
            <li>
              <b>candidates</b> — id, specialization, category из теста (specialization + grade) или null, fspState (linked — есть подтверждённые достижения
              ФСП), claims — подтверждённые утверждения с уровнем доказанности: self_reported (со слов), artifact, third_party, platform.
            </li>
            <li>
              <b>relevance</b> — ваша разметка: relevance[id вакансии][id кандидата] = 0, 1 или 2; кого нет — 0.
            </li>
            <li>
              Базовая линия — кандидаты своей специализации по числу утверждений, без учёта требований. MRR — обратный ранг первого релевантного.
            </li>
          </ul>
          <details className={styles.details}>
            <summary>Каталог утверждений ({catalog.length} id)</summary>
            <ul className={styles.catalog}>
              {catalog.map((c) => (
                <li key={c.id}>
                  <span className={styles.mono}>{c.id}</span> — {c.statement}
                </li>
              ))}
            </ul>
          </details>
        </section>
      </Container>
    </main>
  );
}
