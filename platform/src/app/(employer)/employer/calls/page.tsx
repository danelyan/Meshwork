import { EmployerConsentGate } from '@/components/consent/EmployerConsentGate';
import { companyDisplayName } from '@/lib/company-brand';
import { employerConsentsMissing } from '@/server/consent/service';
import type { Metadata } from 'next';
import Link from 'next/link';

import styles from '@/components/call/call.module.css';
import { Kicker, Notice } from '@/components/ui';
import { formatDate } from '@/lib/labels';
import { requirePageEmployer } from '@/server/auth/page';
import { listEmployerCalls } from '@/server/defense-room';
import { loadEmployerContext } from '@/server/employer';

export const metadata: Metadata = { title: 'Защиты проектов - MESHWORK' };
export const dynamic = 'force-dynamic';

const FLAG = {
  strong_project_weak_defense: 'сильный проект, слабая защита',
  short_defense: 'мало ответов',
  evaluator_disagreement: 'оценщик разошёлся',
  employer_questions_unanswered: 'есть вопросы без ответа',
  no_project_result: 'нет результата проверки',
  uneven_understanding: 'понимание неровное',
} as const;

/** Защиты кандидатов, принявших приглашение компании (ADR 0003): идущие – подключиться, завершённые – транскрипт и оценка. */
export default async function EmployerCallsPage() {
  const s = await requirePageEmployer('/employer/calls');
  // ADR 0005: без оферты и обязательства по данным – вместо данных кандидатов форма принятия условий.
  if ((await employerConsentsMissing(s.userId)).length) return <div className={styles.page}><h1>Защиты проектов</h1><EmployerConsentGate /></div>;
  const ctx = await loadEmployerContext(s.employerProfileId);
  const calls = await listEmployerCalls(ctx);
  return (
    <div className={styles.page}>
      <div>
        <Kicker>{companyDisplayName(ctx.companyName)}</Kicker>
        <h1>Защиты проектов</h1>
        <p className={styles.meta}>
          Видны только кандидаты, принявшие ваше приглашение. Идущую защиту можно слушать и вмешаться; слабая защита при сильном проекте -
          флаг для разговора, а не вывод о подлинности.
        </p>
      </div>
      {calls.length === 0 ? (
        <Notice>Защит пока нет. Кандидат защищает проект после сдачи; вопрос на потом можно оставить в карточке защиты.</Notice>
      ) : (
        <ul className={styles.list}>
          {calls.map((c) => (
            <li key={c.id} className={styles.card}>
              <Link href={`/employer/calls/${encodeURIComponent(c.id)}`}>
                <b>{c.candidateName}</b> - {c.mode === 'project' ? 'защита проекта' : 'ответы на вопросы'}
              </Link>
              <span className={styles.meta}>
                {c.status === 'active' ? 'идёт сейчас' : `завершена ${formatDate(c.finishedAt ?? c.startedAt)}`}
                {c.total !== null ? ` · ${c.total} из 8` : ''}
                {c.flags.length ? ` · ${c.flags.map((f) => FLAG[f]).join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
