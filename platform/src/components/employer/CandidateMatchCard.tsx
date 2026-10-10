import { LevelBadge } from '@/components/LevelBadge';
import type { MatchItem } from '@/server/employer/matching';
import type { PublicSourceType } from '@/server/employer/privacy';

import { Meter, Panel, Tag } from '../ui';

import styles from './Employer.module.css';
import { InviteForm } from './InviteForm';
import { INVITATION_STATUS_LABEL, NO_CANDIDATE_CONTACT, SOURCE_TYPE_LABEL } from './labels';

export interface CandidateMatchCardProps {
  item: MatchItem;
  vacancyId: string | null;
  defaultSalary?: { from: number; to: number };
}

/** Карточка кандидата в подборке: публичная часть (R-E-07) + обоснование (R-M-03) + приглашение. */
function SourceType({ type }: { type: PublicSourceType | null | undefined }) {
  return type ? <span className={styles.meta}> · доказано: {SOURCE_TYPE_LABEL[type]}</span> : null;
}

export function CandidateMatchCard({ item, vacancyId, defaultSalary }: CandidateMatchCardProps) {
  const c = item.candidate;
  const ex = item.explanation;
  const typeByStatement = new Map(c.claims.map((cl) => [cl.statement, cl.sourceType]));
  const open = item.invitation && (item.invitation.status === 'sent' || item.invitation.status === 'viewed');
  return (
    <Panel as="li" className={styles.card} aria-labelledby={`cand-${c.id}`}>
      <div className={styles.cardHead}>
        <h3 id={`cand-${c.id}`}>
          <span className={styles.rank}>#{item.rank} </span>
          {c.displayName}
        </h3>
        <span className={styles.score} title="Покрытие требований с учётом уровня доказанности, категории и ФСП">
          балл {item.score.toFixed(2)}
        </span>
      </div>
      <div className={styles.meta}>
        {c.category ? <Tag tone="solid">{c.category.label} · тест</Tag> : <Tag tone="dashed">без категории</Tag>}
        {c.fsp.hasAchievements && <Tag tone="outline">ФСП</Tag>}
        {!c.category && c.specialization && <Tag>{c.specialization === 'backend' ? 'Backend' : 'Frontend'}</Tag>}
      </div>
      <div>
        <Meter value={item.covered} max={item.total} label={`Закрыто ${item.covered} из ${item.total} требований`} />
        <p className={styles.text}>
          Закрывает {item.covered} из {item.total} требований, доказано артефактами и выше - {ex.proven.length}.
        </p>
      </div>
      {ex.covered.length > 0 && (
        <ul className={styles.why} aria-label="Закрытые требования">
          {ex.covered.map((i) => (
            <li key={i.statement} className={styles.claim}>
              <LevelBadge level={i.level} /> {i.statement}
              <SourceType type={typeByStatement.get(i.statement)} />
            </li>
          ))}
        </ul>
      )}
      {ex.missing.length > 0 && (
        <p className={styles.text}>
          <b>Не хватает:</b> {ex.missing.join('; ')}
        </p>
      )}
      <p className={styles.meta}>
        ФСП: {ex.fsp}. Категория: {ex.category}.{ex.stackMatched.length > 0 && ` Стек в подтверждённых цитатах: ${ex.stackMatched.join(', ')}.`}
      </p>
      {c.claims.length > 0 && (
        <details>
          <summary className={`${styles.meta} ${styles.more}`}>Все подтверждённые карточки ({c.claims.length})</summary>
          <div className={styles.claims}>
            {c.claims.map((cl) => (
              <span key={cl.catalogId} className={styles.claim}>
                <LevelBadge level={cl.level} /> {cl.statement}
                <SourceType type={cl.sourceType} />
              </span>
            ))}
          </div>
        </details>
      )}
      {c.contacts ? (
        <div className={styles.contacts}>
          <span>Приглашение принято. Контакты:</span>
          <span>{c.contacts.name}</span>
          <span>{c.contacts.contact ?? NO_CANDIDATE_CONTACT}</span>
        </div>
      ) : (
        <p className={styles.meta}>Имя и контакты откроются, когда кандидат примет приглашение.</p>
      )}
      {open ? (
        <p className={styles.meta}>
          Приглашение: <span className={styles.status}>{INVITATION_STATUS_LABEL[item.invitation!.status]}</span>
        </p>
      ) : (
        !c.contacts && <InviteForm candidateId={c.id} candidateName={c.displayName} vacancyId={vacancyId} defaultSalaryFrom={defaultSalary?.from} defaultSalaryTo={defaultSalary?.to} />
      )}
    </Panel>
  );
}
