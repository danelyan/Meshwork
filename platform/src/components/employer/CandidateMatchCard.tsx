import { specLabel } from '@/lib/directions';
import { LevelBadge } from '@/components/LevelBadge';
import type { MatchItem } from '@/server/employer/matching';
import type { PublicSourceType } from '@/server/employer/privacy';

import { Button, Meter, Panel, Tag } from '../ui';

import { CandidateQuestions } from './CandidateQuestions';
import { CandidateSilhouette } from './CandidateSilhouette';
import { DefenseBlock, DepthMapBlock, ProjectBlock } from './StageBlocks';

import styles from './Employer.module.css';
import { InviteForm } from './InviteForm';
import { SaveCandidateButton } from './SaveCandidateButton';
import { ASSESSMENT_DISCLAIMER, INVITATION_STATUS_LABEL, NO_CANDIDATE_CONTACT, SOURCE_TYPE_LABEL } from './labels';

export interface CandidateMatchCardProps {
  item: MatchItem;
  vacancyId: string | null;
  defaultSalary?: { from: number; to: number };
  favoriteScope?: string;
  compact?: boolean;
}

/** Карточка кандидата в подборке: публичная часть (R-E-07) + обоснование (R-M-03) + приглашение. */
function SourceType({ type }: { type: PublicSourceType | null | undefined }) {
  return type ? <span className={styles.meta}> · доказано: {SOURCE_TYPE_LABEL[type]}</span> : null;
}

export function CandidateMatchCard({ item, vacancyId, defaultSalary, favoriteScope, compact }: CandidateMatchCardProps) {
  const c = item.candidate;
  const ex = item.explanation;
  const typeByStatement = new Map(c.claims.map((cl) => [cl.statement, cl.sourceType]));
  const open = item.invitation && (item.invitation.status === 'sent' || item.invitation.status === 'viewed');
  if (compact) return <li className={styles.compactCard} aria-labelledby={`cand-${c.id}`}>
    <div className={styles.identity}><CandidateSilhouette /><div><h3 id={`cand-${c.id}`}>{c.displayName}</h3><p>{c.category?.label ?? (c.specialization ? specLabel(c.specialization) : 'Без категории')}</p></div>{favoriteScope && <SaveCandidateButton scope={favoriteScope} candidateId={c.id} compact />}</div>
    <div className={styles.coverage}><strong>{item.total ? Math.round(item.covered / item.total * 100) : 0}<span>%</span></strong><p>покрытие требований вакансии<br />{item.covered} из {item.total} требований</p></div>
    <div className={styles.reasonBox}><h4>Почему на этом месте</h4><dl><div><dt>Покрытие требований</dt><dd>{item.covered}/{item.total}</dd></div><div><dt>Артефакты и выше</dt><dd>{ex.proven.length}</dd></div><div><dt>Категория</dt><dd>{c.category?.label ?? 'не определена'}</dd></div><div><dt>Достижения ФСП</dt><dd>{c.fsp.hasAchievements ? 'есть' : 'не подтверждены'}</dd></div></dl><p className={styles.meta} data-testid="assessment-disclaimer">{ASSESSMENT_DISCLAIMER}</p></div>
    <div className={styles.skillSection}><span className={styles.status}>Закрытые требования</span><div className={styles.skillChips}>{ex.covered.map((claim) => <span key={claim.statement}>{claim.statement}</span>)}</div>{ex.missing.length > 0 && <><span className={styles.status}>Не хватает</span><div className={styles.skillChips} data-missing="true">{ex.missing.map((statement) => <span key={statement}>{statement}</span>)}</div></>}</div>
    <details className={styles.evidenceDetails}><summary>Доказательства и этапы оценки</summary><p className={styles.text}>{ex.summary}</p><p className={styles.meta}>{ex.category}. {ex.fsp}. {ex.subcategory}</p>{ex.depthMap && <DepthMapBlock depth={ex.depthMap} />}{ex.project && <ProjectBlock project={ex.project} />}{ex.defense && <DefenseBlock defense={ex.defense} />}<div className={styles.claims}>{c.claims.map((claim) => <span key={claim.catalogId} className={styles.claim}><LevelBadge level={claim.level} />{claim.statement}<SourceType type={claim.sourceType} /></span>)}</div></details>
    {c.contacts ? <><div className={styles.contacts}><strong>{c.contacts.name}</strong><span>{c.contacts.contact ?? NO_CANDIDATE_CONTACT}</span></div>{item.defenseRoom && <Button href={`/employer/calls/${item.defenseRoom.sessionId}`}>Комната защиты →</Button>}<CandidateQuestions candidateId={c.id} /></> : open ? <div className={styles.sentBox}>Приглашение {INVITATION_STATUS_LABEL[item.invitation!.status]}<Button href="/employer/invitations" size="sm">Статусы →</Button></div> : <InviteForm candidateId={c.id} candidateName={c.displayName} vacancyId={vacancyId} defaultSalaryFrom={defaultSalary?.from} defaultSalaryTo={defaultSalary?.to} />}
  </li>;
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
      {favoriteScope && <SaveCandidateButton scope={favoriteScope} candidateId={c.id} />}
      <div className={styles.meta}>
        {c.category ? <Tag tone="solid">{c.category.label} · тест</Tag> : <Tag tone="dashed">без категории</Tag>}
        {c.fsp.hasAchievements && <Tag tone="outline">ФСП</Tag>}
        {!c.category && c.specialization && <Tag>{specLabel(c.specialization)}</Tag>}
        {item.subcategoryFit === 'neighbour' && (
          <Tag tone="dashed" data-testid="neighbour-sub">
            соседняя подкатегория
          </Tag>
        )}
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
        ФСП: {ex.fsp}. Категория: {ex.category}.{ex.subcategory && ` Подкатегория: ${ex.subcategory}.`}{ex.stackMatched.length > 0 && ` Стек в подтверждённых цитатах: ${ex.stackMatched.join(', ')}.`}
      </p>
      {ex.depthMap && <DepthMapBlock depth={ex.depthMap} />}
      {ex.project && <ProjectBlock project={ex.project} />}
      {ex.defense && <DefenseBlock defense={ex.defense} />}
      <p className={styles.meta} data-testid="assessment-disclaimer">{ASSESSMENT_DISCLAIMER}</p>
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
      {c.contacts && item.defenseRoom && (
        <div>
          <Button href={`/employer/calls/${item.defenseRoom.sessionId}`} variant="cta" size="sm">
            Комната защиты
          </Button>
          <span className={styles.meta}> {item.defenseRoom.status === 'active' ? 'защита идёт' : 'ждёт кандидата'}</span>
        </div>
      )}
      {c.contacts && <CandidateQuestions candidateId={c.id} />}
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
