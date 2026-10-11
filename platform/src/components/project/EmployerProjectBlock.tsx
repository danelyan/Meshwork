'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { ApiError } from '@/lib/api';
import { inviteToDefenseApi, listProjectSubmissionsApi, saveNeedProjectApi } from '@/lib/project-api';
import type { EmployerSubmissionView, EmployerTaskView, TemplateView } from '@/server/project/service';

import emp from '../employer/Employer.module.css';
import { Button, Field, Notice, Panel, Tag } from '../ui';
import ui from '../ui.module.css';

import { FLAG_RU, GRADE_RU, SUBMISSION_STATUS, hours } from './labels';
import styles from './Project.module.css';
import { RubricTable } from './SubmissionResult';

export interface EmployerProjectBlockProps {
  vacancyId: string;
  specialization: string;
  grade: string;
  salaryFrom: number;
  salaryTo: number;
  archived: boolean;
  initialTask: EmployerTaskView | null;
  templates: TemplateView[];
  /** Обязательные критерии на выбор: требования потребности + то, что шаблоны проверяют по построению. */
  criteriaOptions: { id: string; statement: string }[];
}

/** Блок «Проектное задание» в карточке потребности (ADR 0003, ступень 2): шаблон, критерии, пожелания, условие, сдачи. */
export function EmployerProjectBlock(props: EmployerProjectBlockProps) {
  const { vacancyId, archived } = props;
  const [task, setTask] = useState<EmployerTaskView | null>(props.initialTask);
  const defaultTpl = props.templates.find((t) => t.specialization === props.specialization && t.grade === props.grade) ?? props.templates[0];
  const [templateId, setTemplateId] = useState(task?.template.id ?? defaultTpl?.id ?? '');
  const [required, setRequired] = useState<string[]>(task?.requiredCatalogIds ?? []);
  const [wishes, setWishes] = useState(task?.wishesText ?? '');
  const [visibility, setVisibility] = useState<'open' | 'invited'>(task?.visibility ?? 'open');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subs, setSubs] = useState<EmployerSubmissionView[]>([]);

  const load = useCallback(async () => {
    try {
      setSubs((await listProjectSubmissionsApi(vacancyId)).items);
    } catch {
      /* блок сдач необязателен для остальной страницы */
    }
  }, [vacancyId]);

  useEffect(() => {
    if (task) void load();
  }, [task, load]);

  const running = subs.some((s) => s.status === 'submitted' || s.status === 'running');
  useEffect(() => {
    if (!running) return;
    const t = setTimeout(load, 4000);
    return () => clearTimeout(t);
  }, [running, subs, load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setTask(await saveNeedProjectApi(vacancyId, { templateId, requiredCatalogIds: required, wishesText: wishes.trim() || null, visibility }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сформировать задание');
    } finally {
      setBusy(false);
    }
  }

  const locked = (task?.stats.submissions ?? 0) > 0;
  const tpl = props.templates.find((t) => t.id === templateId);

  return (
    <section className={emp.list} aria-label="Проектное задание">
      <div>
        <h2 className={emp.sectionTitle}>Проектное задание</h2>
        <p className={emp.lead}>
          Шаблон платформы задаёт контракт и скрытые тесты (балл воспроизводим). Ты добавляешь обязательные критерии из каталога и
          пожелания — ИИ пишет условие в домене твоей команды и рубрику. Кандидаты видят задание в ленте без названия компании и зарплаты.
        </p>
      </div>
      {!archived && !locked && (
        <Panel as="form" className={emp.form} onSubmit={save} aria-label="Настройка проектного задания">
          <Field label="Шаблон" hint={tpl ? `${tpl.summary} · ${hours(tpl.timeBudgetMin)} · тестов: ${tpl.tests.visible} видимых, ${tpl.tests.hidden} скрытых` : undefined}>
            <select className={ui.input} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {props.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.subcategoryTitle} · {GRADE_RU[t.grade] ?? t.grade} — {t.title}
                </option>
              ))}
            </select>
          </Field>
          <fieldset className={emp.checks}>
            <legend className={ui.label}>Обязательные критерии (каталог утверждений)</legend>
            {props.criteriaOptions.map((c) => (
              <label key={c.id}>
                <input
                  type="checkbox"
                  checked={required.includes(c.id)}
                  onChange={(e) => setRequired((r) => (e.target.checked ? [...r, c.id] : r.filter((x) => x !== c.id)))}
                />
                {c.statement}
              </label>
            ))}
          </fieldset>
          <Field label="Пожелания свободным текстом" hint="Что ещё хочешь увидеть в решении. Каждое пожелание станет пунктом рубрики; проверка — пояснением, не баллом.">
            <textarea className={`${ui.input} ${styles.textarea}`} value={wishes} maxLength={2000} onChange={(e) => setWishes(e.target.value)} />
          </Field>
          <Field label="Кому видно">
            <select className={ui.input} value={visibility} onChange={(e) => setVisibility(e.target.value as 'open' | 'invited')}>
              <option value="open">Лента: все кандидаты направления</option>
              <option value="invited">Только приглашённые по этой вакансии</option>
            </select>
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
          <div className={emp.actions}>
            <Button type="submit" variant="cta" size="sm" loading={busy}>
              {task ? 'Перегенерировать условие' : 'Сформировать задание'}
            </Button>
          </div>
        </Panel>
      )}
      {locked && <Notice>Задание уже сдают — условие зафиксировано, чтобы всех проверяли по одному тексту.</Notice>}

      {task && (
        <Panel className={emp.card} aria-label="Условие задания">
          <div className={emp.cardHead}>
            <h3>{task.spec.title}</h3>
            <Tag tone="outline">{task.spec.source === 'llm' ? 'условие — ИИ' : 'условие — шаблон'}</Tag>
          </div>
          <div className={emp.meta}>
            <span>{task.template.subcategoryTitle}</span>
            <span>{GRADE_RU[task.template.grade] ?? task.template.grade}</span>
            <span>{task.visibility === 'open' ? 'в ленте' : 'по приглашению'}</span>
            <span>взяли: {task.stats.taken}</span>
            <span>сдач: {task.stats.submissions}</span>
          </div>
          <p className={styles.prose}>{task.spec.domainStory}</p>
          <ul className={styles.bullets}>
            {task.spec.requirements.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <details className={styles.details}>
            <summary>Как проверяется и рубрика ({task.rubric.criteria.length})</summary>
            <ul className={styles.bullets}>
              {task.spec.acceptance.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <ul className={styles.bullets}>
              {task.rubric.criteria.map((c) => (
                <li key={c.id}>
                  {c.source === 'required' ? 'обязательный' : 'пожелание'}: {c.text}
                </li>
              ))}
            </ul>
          </details>
          {task.spec.contractMd && (
            <details className={styles.details}>
              <summary>Контракт шаблона — кандидат получает его дословно</summary>
              <pre className={styles.code}>{task.spec.contractMd}</pre>
            </details>
          )}
        </Panel>
      )}

      {task && subs.length > 0 && (
        <div className={emp.list}>
          <h3 className={emp.sectionTitle}>Сдачи ({subs.length})</h3>
          {subs.map((s) => (
            <SubmissionCard key={s.id} s={s} salaryFrom={props.salaryFrom} salaryTo={props.salaryTo} onInvited={load} />
          ))}
        </div>
      )}
    </section>
  );
}

/** Вердикт ИИ-защиты (ADR 0008 п. 1): баллы по рубрике A-02 и флаги; текст кандидата и запись — после принятия приглашения. */
function AiDefenseBlock({ d, open }: { d: NonNullable<EmployerSubmissionView['aiDefense']>; open: boolean }) {
  const v = d.verdict;
  return (
    <section className={styles.aiDefense} aria-label="ИИ-защита проекта">
      <h4>ИИ-защита проекта</h4>
      {!v ? (
        <p className={emp.status}>{d.status === 'active' ? 'Кандидат сейчас проходит ИИ-защиту.' : 'Вердикта пока нет.'}</p>
      ) : (
        <>
          <p>
            {v.total === null
              ? 'Оценки нет: кандидат не ответил ни на один вопрос.'
              : `Рубрика A-02: ${String(v.totalMean ?? v.total).replace('.', ',')} из 8 - ${v.passed ? 'понимание своего кода показано' : 'ниже порога'} (3 прогона оценщика, медиана).`}
          </p>
          {v.items.length > 0 && (
            <ul className={styles.bullets} aria-label="Баллы по вопросам">
              {v.items.map((i, k) => (
                <li key={k} className={i.passed ? styles.pass : styles.fail}>
                  {i.label}: {i.total} из 8
                </li>
              ))}
            </ul>
          )}
          {v.notes.map((n, k) => (
            <p key={v.flags[k] ?? k} className={styles.flag} data-flag={v.flags[k]}>
              {n}
            </p>
          ))}
        </>
      )}
      <p className={emp.status}>{open ? <>Транскрипт и запись - в разделе <a href="/employer/calls">«Защиты»</a>.</> : 'Транскрипт и запись - после принятия приглашения.'}</p>
    </section>
  );
}

function SubmissionCard({ s, salaryFrom, salaryTo, onInvited }: { s: EmployerSubmissionView; salaryFrom: number; salaryTo: number; onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('Приглашаем на защиту проекта: разберём решения и обсудим работу в команде.');
  const [from, setFrom] = useState(String(salaryFrom));
  const [to, setTo] = useState(String(salaryTo));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = s.result;

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await inviteToDefenseApi(s.id, { message: message.trim(), salaryFrom: Number(from.replace(/\s/g, '')), salaryTo: Number(to.replace(/\s/g, '')) });
      setOpen(false);
      onInvited();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось пригласить');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel className={emp.card} aria-label={`Сдача: ${s.candidate.displayName}`}>
      <div className={emp.cardHead}>
        <h3>{s.candidate.displayName}</h3>
        <span className={emp.status}>{SUBMISSION_STATUS[s.status]}</span>
      </div>
      <div className={emp.meta}>
        {s.candidate.category && <Tag tone="solid">{s.candidate.category}</Tag>}
        <span>{new Date(s.submittedAt).toLocaleString('ru-RU')}</span>
        {s.late && <Tag>сдано после срока</Tag>}
        {s.repoUrl ? <a href={s.repoUrl}>{s.repoUrl}</a> : <span>репозиторий — после принятия приглашения</span>}
      </div>
      {s.error && <Notice tone="error">{s.error}</Notice>}
      {r && (
        <>
          <div>
            <span className={styles.scoreBig}>{r.tests.score}</span> / 100 — скрытые тесты {r.tests.passed} из {r.tests.total}
            {r.runner.mode === 'stub' && <span className={emp.status}> · демо-проверка без песочницы</span>}
          </div>
          {r.platformOwnedViolations.length > 0 && <p className={styles.flag}>Изменены файлы платформы: {r.platformOwnedViolations.map((v) => `${v.path} (${v.reason === 'missing' ? 'удалён' : 'изменён'})`).join(', ')}</p>}
          {r.rubric.injectionSuspected && <p className={styles.flag}>{FLAG_RU.possible_prompt_injection}</p>}
          <RubricTable results={r.rubric.results} />
          <details className={styles.details}>
            <summary>Скрытые тесты и журнал работы с ИИ</summary>
            <ul className={styles.bullets}>
              {r.hiddenTests.map((t) => (
                <li key={t.name} className={t.passed ? styles.pass : styles.fail}>
                  {t.passed ? '✓' : '✗'} {t.name}
                </li>
              ))}
            </ul>
            <p className={styles.prose}>{s.aiLogText || 'Журнал не приложен.'}</p>
          </details>
        </>
      )}
      {s.aiDefense && <AiDefenseBlock d={s.aiDefense} open={s.repoUrl !== null} />}
      {s.defense ? (
        <Notice>Приглашён на защиту · приглашение: {s.defense.invitationStatus}</Notice>
      ) : (
        s.status === 'checked' &&
        (open ? (
          <form className={emp.inviteBox} onSubmit={invite} aria-label={`Пригласить на защиту: ${s.candidate.displayName}`}>
            <Field label="Сообщение">
              <textarea className={ui.input} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            </Field>
            <div className={emp.salaryRow}>
              <Field label="Зарплата от, ₽ в месяц">
                <input className={ui.input} inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field label="до, ₽ в месяц">
                <input className={ui.input} inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value)} />
              </Field>
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <div className={emp.actions}>
              <Button type="submit" variant="cta" size="sm" loading={busy}>
                Отправить приглашение
              </Button>
              <Button size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Отмена
              </Button>
            </div>
          </form>
        ) : (
          <div className={emp.actions}>
            <Button variant="cta" size="sm" onClick={() => setOpen(true)}>
              Пригласить на защиту
            </Button>
          </div>
        ))
      )}
    </Panel>
  );
}
