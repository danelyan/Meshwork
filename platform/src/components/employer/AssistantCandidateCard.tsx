import { LevelBadge } from '@/components/LevelBadge';
import type { AssistantCandidateView } from '@/server/agent/employer/types';

import { Meter, Tag } from '../ui';

import styles from './Employer.module.css';
import { InviteForm } from './InviteForm';
import { INVITATION_STATUS_LABEL, SOURCE_TYPE_LABEL } from './labels';

/**
 * Компактная карточка кандидата в ленте помощника: та же публичная часть, что
 * CandidateMatchCard (R-E-07, R-M-03), но из карточки помощника: имя показывается
 * только если сервер прислал `name` (у компании есть принятое приглашение), иначе
 * псевдоним. Контакты — по-прежнему только в «Приглашениях».
 */
export function AssistantCandidateCard({ c, vacancyId, defaultSalary }: { c: AssistantCandidateView; vacancyId: string | null; defaultSalary?: number }) {
  const open = c.invitation === 'sent' || c.invitation === 'viewed';
  const proven = c.coveredItems.filter((i) => i.level !== 'self_reported').length;
  return (
    <li className={styles.card} aria-labelledby={`acand-${c.candidateId}`} data-testid="assistant-candidate">
      <div className={styles.cardHead}>
        <h3 id={`acand-${c.candidateId}`}>
          <span className={styles.rank}>#{c.rank} </span>
          {c.name ?? c.alias}
          {c.name && <span className={styles.meta}> · {c.alias}</span>}
        </h3>
        <span className={styles.score} title="Покрытие требований с учётом уровня доказанности, категории и ФСП">
          балл {c.score.toFixed(2)}
        </span>
      </div>
      <div className={styles.meta}>
        {c.category ? <Tag tone="solid">{c.category} · тест</Tag> : <Tag tone="dashed">без категории</Tag>}
        {c.fsp && <Tag tone="outline">ФСП</Tag>}
      </div>
      <div>
        <Meter value={c.covered} max={c.total} label={`Закрыто ${c.covered} из ${c.total} требований`} />
        <p className={styles.text}>
          Закрывает {c.covered} из {c.total}, доказано артефактами и выше - {proven}.
        </p>
      </div>
      {c.coveredItems.length > 0 && (
        <details>
          <summary className={`${styles.meta} ${styles.more}`}>Что закрыто ({c.coveredItems.length})</summary>
          <ul className={styles.why} aria-label="Закрытые требования">
            {c.coveredItems.map((i) => (
              <li key={i.statement} className={styles.claim}>
                <LevelBadge level={i.level} /> {i.statement}
                {i.sourceType && <span className={styles.meta}> · доказано: {SOURCE_TYPE_LABEL[i.sourceType]}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {c.missing.length > 0 && (
        <p className={styles.text}>
          <b>Не хватает:</b> {c.missing.join('; ')}
        </p>
      )}
      {c.invitation === 'accepted' ? (
        <p className={styles.meta}>
          Приглашение принято — контакты в разделе <a href="/employer/invitations">«Приглашения»</a>.
        </p>
      ) : open ? (
        <p className={styles.meta}>
          Приглашение: <span className={styles.status}>{INVITATION_STATUS_LABEL[c.invitation!]}</span>
        </p>
      ) : (
        <InviteForm candidateId={c.candidateId} candidateName={c.alias} vacancyId={vacancyId} defaultSalary={defaultSalary} />
      )}
    </li>
  );
}
