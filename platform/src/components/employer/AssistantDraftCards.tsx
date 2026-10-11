'use client';

import Link from 'next/link';
import { useState } from 'react';

import { ApiError } from '@/lib/api';
import { CompanyFieldsError, updateCompanyApi, type CompanyBody } from '@/lib/employer-api';
import { saveNeedProjectApi } from '@/lib/project-api';
import type { CompanyDraft, ProjectTaskDraft } from '@/server/agent/employer/types';

import { AssistantRow, MessageCard } from '../chat/Thread';
import { Button, Notice } from '../ui';

import styles from './Employer.module.css';

const COMPANY_FIELDS = [
  ['name', 'Название'],
  ['industry', 'Сфера'],
  ['description', 'Описание'],
  ['contact', 'Контакт для приглашений'],
] as const;

function errorText(e: unknown, fallback: string): string {
  if (e instanceof CompanyFieldsError) {
    const parts = Object.values(e.fields).filter(Boolean);
    return parts.length ? parts.join('. ') : e.message;
  }
  return e instanceof ApiError ? e.message : fallback;
}

/** Черновик профиля компании: «было → станет», применяет человек кнопкой (PATCH /api/employer/company). */
export function CompanyDraftRow({ draft }: { draft: CompanyDraft }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);
  const changes = COMPANY_FIELDS.filter(([k]) => draft[k] !== null);

  async function apply() {
    if (state !== 'idle') return;
    setState('busy');
    setError(null);
    const body: Partial<CompanyBody> = {};
    for (const [k] of changes) body[k] = draft[k] as string;
    try {
      await updateCompanyApi(body);
      setState('done');
    } catch (e) {
      setError(errorText(e, 'Не удалось применить изменения'));
      setState('idle');
    }
  }

  return (
    <AssistantRow mark={false} testId="assistant-company-draft">
      <MessageCard label="Черновик профиля компании">
        <h3 className={styles.sectionTitle}>Черновик профиля компании</h3>
        <ul className={styles.why} aria-label="Что изменится">
          {changes.map(([k, label]) => (
            <li key={k}>
              <b>{label}:</b> {draft.current[k] ?? 'не указано'} → {draft[k]}
            </li>
          ))}
        </ul>
        <p className={styles.meta}>{draft.rationale}</p>
        {error && <Notice tone="error">{error}</Notice>}
        {state === 'done' ? (
          <Notice>
            Применено. <Link href="/employer/company">Профиль компании</Link>
          </Notice>
        ) : (
          <div className={styles.actions}>
            <Button variant="cta" size="sm" loading={state === 'busy'} disabled={changes.length === 0} onClick={() => void apply()}>
              Применить
            </Button>
          </div>
        )}
      </MessageCard>
    </AssistantRow>
  );
}

/** Черновик проектного задания: «Сформировать» = тот же POST, что у формы EmployerProjectBlock. */
export function ProjectTaskDraftRow({ draft }: { draft: ProjectTaskDraft }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (state !== 'idle') return;
    setState('busy');
    setError(null);
    try {
      await saveNeedProjectApi(draft.vacancyId, {
        templateId: draft.templateId,
        requiredCatalogIds: draft.criteria.map((c) => c.catalogId),
        wishesText: draft.wishes.trim() || null,
        visibility: draft.visibility === 'feed' ? 'open' : 'invited',
      });
      setState('done');
    } catch (e) {
      setError(errorText(e, 'Не удалось сформировать задание'));
      setState('idle');
    }
  }

  return (
    <AssistantRow mark={false} testId="assistant-project-task-draft">
      <MessageCard label={`Черновик задания: ${draft.vacancyTitle}`}>
        <h3 className={styles.sectionTitle}>Задание к вакансии «{draft.vacancyTitle}»</h3>
        <p className={styles.meta}>
          Шаблон: {draft.templateTitle} · видно: {draft.visibility === 'feed' ? 'в ленте заданий' : 'только приглашённым'}
        </p>
        <ul className={styles.why} aria-label="Критерии проверки">
          {draft.criteria.map((c) => (
            <li key={c.catalogId}>{c.statement}</li>
          ))}
        </ul>
        {draft.wishes.trim() && <p className={styles.meta}>Пожелания: {draft.wishes}</p>}
        <p className={styles.meta}>{draft.rationale}</p>
        {draft.replacesExisting && state !== 'done' && <Notice>К этой вакансии уже есть задание: новое заменит его.</Notice>}
        {error && <Notice tone="error">{error}</Notice>}
        {state === 'busy' && <Notice>Формирую условие, это может занять до минуты…</Notice>}
        {state === 'done' ? (
          <Notice>
            Задание сформировано. <Link href={`/employer/needs/${encodeURIComponent(draft.vacancyId)}`}>Открыть вакансию</Link>
          </Notice>
        ) : (
          <div className={styles.actions}>
            <Button variant="cta" size="sm" loading={state === 'busy'} onClick={() => void create()}>
              Сформировать задание
            </Button>
          </div>
        )}
      </MessageCard>
    </AssistantRow>
  );
}
