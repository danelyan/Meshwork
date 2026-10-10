import type { Metadata } from 'next';

import styles from '@/components/call/call.module.css';
import { DefenseEntry } from '@/components/call/DefenseEntry';
import { Kicker, Notice } from '@/components/ui';
import { formatDate } from '@/lib/labels';
import { requirePageCandidate } from '@/server/auth/page';
import { listCandidateSubmissions, pendingEmployerQuestions } from '@/server/defense-room';

export const metadata: Metadata = { title: 'Защита проекта - ФСП Карьера' };
export const dynamic = 'force-dynamic';

/**
 * Вход в защиту проекта (ADR 0003, ступень 3): сабмиты проектов и вопросы работодателей в очереди.
 * Минимальная страница лейна defense-room; карточку сабмита `/projects/[submissionId]` делает лейн project.
 */
export default async function DefenseRoomIndex() {
  const s = await requirePageCandidate('/defense-room');
  const [subs, pending] = await Promise.all([listCandidateSubmissions(s.candidateId), pendingEmployerQuestions(s.candidateId)]);
  return (
    <div className={styles.page}>
      <div>
        <Kicker>Ступень 3</Kicker>
        <h1>Защита проекта</h1>
        <p className={styles.meta}>
          ИИ-интервьюер задаст вопросы по твоему коду и коммитам: что делает, почему так, что сломается, как изменить. Работодатель, чьё
          приглашение ты принял, может подключиться и спросить сам. Оценку ставит отдельный оценщик по транскрипту.
        </p>
      </div>

      {pending.total > 0 && (
        <section className={styles.card} data-testid="pending-questions">
          <b>
            У работодателей {pending.total === 1 ? 'есть вопрос' : `${pending.total} вопроса(ов)`} к тебе
          </b>
          <span className={styles.meta}>{pending.byCompany.map((c) => `${c.companyName}: ${c.count}`).join(' · ')}</span>
          <div>
            <DefenseEntry questions label={pending.activeSessionId ? 'Продолжить ответы' : 'Ответить'} />
          </div>
        </section>
      )}

      {subs.length === 0 ? (
        <Notice>Сданных проектов пока нет. Проект приходит с приглашением работодателя; после сдачи репозитория его можно защитить здесь.</Notice>
      ) : (
        <ul className={styles.list}>
          {subs.map((sub) => (
            <li key={sub.id} className={styles.card}>
              <b>{sub.repoUrl}</b>
              <span className={styles.meta}>
                Сдан {formatDate(sub.submittedAt)} · проверка: {sub.status}
                {sub.lastDefense?.verdict?.total != null ? ` · последняя защита: ${sub.lastDefense.verdict.total} из 8` : ''}
              </span>
              <div>
                <DefenseEntry projectSubmissionId={sub.id} label={sub.lastDefense?.status === 'active' ? 'Продолжить защиту' : 'Защитить проект'} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
