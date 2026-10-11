'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api';
import { submitProjectApi, takeProjectApi } from '@/lib/project-api';
import { DefenseEntry } from '@/components/call/DefenseEntry';
import type { CandidateTaskView } from '@/server/project/service';

import emp from '../employer/Employer.module.css';
import { Button, Field, Kicker, Notice, Panel, Tag } from '../ui';
import ui from '../ui.module.css';

import { GRADE_RU, SUBMISSION_STATUS, hours } from './labels';
import styles from './Project.module.css';
import { RubricTable } from './SubmissionResult';
import { useSubmissionPolling } from './useSubmissionPolling';

/** Страница задания кандидату: условие, контракт, видимые тесты, заготовка, сдача и результат. */
export function ProjectTaskView({ task }: { task: CandidateTaskView }) {
  const router = useRouter();
  const [subs, setSubs] = useSubmissionPolling(task.submissions);
  const pending = subs.find((s) => s.status === 'submitted' || s.status === 'running');
  const [kind, setKind] = useState<'code' | 'approach'>('code');
  const [repoUrl, setRepoUrl] = useState('');
  const [approach, setApproach] = useState('');
  const [aiLog, setAiLog] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoErr, setRepoErr] = useState<string | null>(null);

  async function take() {
    setBusy(true);
    setError(null);
    try {
      await takeProjectApi(task.id);
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось взять задание');
    } finally {
      setBusy(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (kind === 'code' && !/^https:\/\/(www\.)?github\.com\/[^/\s]+\/[^/\s]+\/?$/.test(repoUrl.trim())) {
      setRepoErr('Ссылка вида https://github.com/<владелец>/<репозиторий>');
      return;
    }
    if (kind === 'approach' && approach.trim().length < 200) {
      setRepoErr('Опиши подход хотя бы в 200 символах: что сделаешь, в каком порядке, какие ограничения учтёшь');
      return;
    }
    setRepoErr(null);
    setBusy(true);
    setError(null);
    try {
      const created = await submitProjectApi(task.id, kind === 'code' ? { kind, repoUrl: repoUrl.trim(), aiLogText: aiLog } : { kind, approachText: approach.trim(), aiLogText: aiLog });
      setSubs((list) => [created, ...list]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сдать проект');
    } finally {
      setBusy(false);
    }
  }

  const { spec } = task;
  return (
    <div className={emp.page}>
      <div>
        <Kicker>Проектное задание</Kicker>
        <h1>{task.title}</h1>
        <div className={emp.meta}>
          <Tag tone="outline">{task.specializationLabel}</Tag>
          {task.subcategoryTitle && <Tag tone="outline">{task.subcategoryTitle}</Tag>}
          <Tag tone="outline">{GRADE_RU[task.grade] ?? task.grade}</Tag>
          <span>{hours(task.timeBudgetMin)}</span>
          <span>{task.stack.join(', ')}</span>
          {task.my.expiresAt && (new Date(task.my.expiresAt).getTime() > Date.now() ? <span>сдать до {new Date(task.my.expiresAt).toLocaleDateString('ru-RU')}</span> : <span>срок истёк – сдать можно, работодатель увидит пометку «после срока»</span>)}
        </div>
      </div>
      {error && <Notice tone="error">{error}</Notice>}

      <Panel className={emp.card}>
        <p className={styles.prose}>{spec.domainStory}</p>
        <h2 className={emp.sectionTitle}>Требования</h2>
        <ul className={styles.bullets}>
          {spec.requirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <h2 className={emp.sectionTitle}>Как проверяется</h2>
        <ul className={styles.bullets}>
          {spec.acceptance.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        {spec.notes && <p className={styles.prose}>{spec.notes}</p>}
        <details className={styles.details}>
          <summary>Контракт (contract.md, дословно) – при расхождении с условием прав он</summary>
          <pre className={styles.code}>{task.contractMd}</pre>
        </details>
        <details className={styles.details}>
          <summary>Видимые тесты ({task.visibleTests.length})</summary>
          {task.visibleTests.map((f) => (
            <div key={f.path}>
              <div className={emp.status}>{f.path}</div>
              <pre className={styles.code}>{f.content}</pre>
            </div>
          ))}
        </details>
        <div className={emp.actions}>
          {task.my.taken ? (
            <Button href={task.skeletonUrl} variant="primary" size="sm" download prefetch={false}>
              Скачать заготовку (.zip)
            </Button>
          ) : (
            <Button variant="cta" size="sm" loading={busy} onClick={take}>
              Взять задание
            </Button>
          )}
        </div>
      </Panel>

      {task.my.taken && (
        <Panel as="form" className={emp.form} onSubmit={submit} aria-label="Сдать проект">
          <h2 className={emp.sectionTitle}>Сдать проект</h2>
          <fieldset className={styles.kindSwitch}>
            <legend className={emp.status}>Формат сдачи</legend>
            <label className={styles.kindOption}>
              <input type="radio" name="kind" value="code" checked={kind === 'code'} onChange={() => setKind('code')} /> Код в репозитории – автотесты дают балл, работодатель может позвать на защиту
            </label>
            <label className={styles.kindOption}>
              <input type="radio" name="kind" value="approach" checked={kind === 'approach'} onChange={() => setKind('approach')} /> Подход к решению текстом – без кода и балла, только критерии работодателя
            </label>
          </fieldset>
          {kind === 'code' ? (
            <Field label="Репозиторий на GitHub" hint="Только публичный репозиторий: приватный без токена не скачать (GitHub ответит «не найден»). Проверяется последний коммит ветки по умолчанию." error={repoErr ?? undefined}>
              <input className={ui.input} value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/login/booking-api" inputMode="url" />
            </Field>
          ) : (
            <Field label="Подход к решению" hint="Что сделаешь и в каком порядке, какие структуры данных и проверки, какие ограничения и риски учтёшь, что оставишь за рамками. 200–8000 символов. Работодатель увидит текст, контакты в нём скроются." error={repoErr ?? undefined}>
              <textarea className={`${ui.input} ${styles.textarea}`} value={approach} maxLength={8000} onChange={(e) => setApproach(e.target.value)} />
            </Field>
          )}
          <Field label="Журнал работы с ИИ" hint="Какие ассистенты, что спрашивал, что принял и что переписал сам. Это не штраф: на защите спросят про решения, а не про то, кто набирал код.">
            <textarea className={`${ui.input} ${styles.textarea}`} value={aiLog} maxLength={20000} onChange={(e) => setAiLog(e.target.value)} />
          </Field>
          <div className={emp.actions}>
            <Button type="submit" variant="cta" size="sm" loading={busy} disabled={!!pending}>
              {pending ? 'Идёт проверка…' : 'Сдать на проверку'}
            </Button>
          </div>
        </Panel>
      )}

      {subs.length > 0 && (
        <section aria-label="Сдачи" className={emp.list}>
          <h2 className={emp.sectionTitle}>Сдачи</h2>
          {subs.map((s) => (
            <Panel key={s.id} className={styles.result}>
              <div className={emp.cardHead}>
                <span className={emp.status} role="status">
                  {SUBMISSION_STATUS[s.status]}
                </span>
                <span className={emp.rank}>
                  {s.kind === 'approach' ? 'подход · ' : s.commitSha ? `${s.commitSha.slice(0, 7)} · ` : ''}{new Date(s.submittedAt).toLocaleString('ru-RU')}
                </span>
              </div>
              {s.error && <Notice tone="error">{s.error}</Notice>}
              {s.kind === 'approach' && s.approachText && (
                <details className={styles.details}>
                  <summary>Текст подхода</summary>
                  <p className={styles.prose}>{s.approachText}</p>
                </details>
              )}
              {s.result && (
                <>
                  {s.result.kind === 'approach' ? (
                    <p className={emp.status}>Сдача подходом: автотестов нет, оценка – по критериям работодателя.</p>
                  ) : (
                    <div>
                      <span className={styles.scoreBig}>{s.result.tests.score}</span> / 100 – скрытые тесты: {s.result.tests.passed} из {s.result.tests.total}
                    </div>
                  )}
                  {s.result.visibleTests.length > 0 && (
                    <ul className={styles.bullets} aria-label="Видимые тесты">
                      {s.result.visibleTests.map((t) => (
                        <li key={t.name} className={t.passed ? styles.pass : styles.fail}>
                          {t.passed ? '✓' : '✗'} {t.name}
                        </li>
                      ))}
                    </ul>
                  )}
                  {s.result.platformOwnedViolations.length > 0 && (
                    <Notice tone="error">Изменены файлы платформы: {s.result.platformOwnedViolations.map((v) => v.path).join(', ')}. Работодатель увидит это как флаг.</Notice>
                  )}
                  <p className={emp.status}>{s.result.lint.note}</p>
                  <RubricTable results={s.result.rubric.results} />
                </>
              )}
              {s.status === 'checked' && s.kind === 'code' && (
                <div className={styles.aiDefense}>
                  <p className={emp.status}>
                    ИИ задаст вопросы по твоему коду и коммитам. Работодатели до приглашения увидят только баллы и флаги - без транскрипта, записи и ссылки на репозиторий. Не чаще раза в сутки.
                  </p>
                  <DefenseEntry projectSubmissionId={s.id} ai label="Защитить проект с ИИ" />
                </div>
              )}
            </Panel>
          ))}
        </section>
      )}
    </div>
  );
}
