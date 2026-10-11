import Link from 'next/link';
import { companyDisplayName } from '@/lib/company-brand';

import { CandidateActions, UserActions } from '@/components/admin/actions';
import { RevealPii } from '@/components/admin/RevealPii';
import {
  ATTEMPT_STATUS_LABEL,
  CALL_KIND_LABEL,
  CLAIM_STATUS_LABEL,
  COMPLAINT_REASON_LABEL,
  COMPLAINT_STATUS_LABEL,
  CONSENT_LABEL,
  EVIDENCE_LABEL,
  FSP_LABEL,
  GRADE_LABEL,
  INVITATION_STATUS_LABEL,
  OBJECTION_SUBJECT_LABEL,
  SPEC_LABEL,
  fmtDate,
  fmtDateTime,
  fmtMoney,
} from '@/components/admin/labels';
import { Panel, Tag } from '@/components/ui';
import { isHiddenByModerator } from '@/server/admin/accounts/state';
import { getCandidateCard, objectionDeadline } from '@/server/admin/overview/cards';
import { can } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from '../../admin.module.css';
import { orNotFound } from '../../listing';

function integrityLevel(v: unknown): string {
  const lvl = (v as { level?: unknown } | null)?.level;
  return typeof lvl === 'string' ? lvl : '–';
}

/** Карточка кандидата. Категорию и грейд админ не меняет вообще (принцип 2 E-08): их ставит только тест. */
export default async function AdminCandidatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageStaff(`/admin/candidates/${id}`, 'view_candidates');
  const c = await orNotFound(getCandidateCard(id));
  const cat = c.currentCategory;
  const hiddenByModerator = await isHiddenByModerator(c.id);
  return (
    <>
      <h1 className={styles.title}>{c.pseudonym}</h1>
      <Panel className={styles.section}>
        <dl className={styles.kv}>
          <dt>id</dt>
          <dd className={styles.mono}>{c.id}</dd>
          <dt>Почта</dt>
          <dd className={styles.mono}>{c.email ?? '–'}</dd>
          <dt>Категория</dt>
          <dd>{cat ? `${SPEC_LABEL[cat.specialization]} · ${GRADE_LABEL[cat.grade]} (с ${fmtDate(cat.confirmedAt)})` : 'нет – категорию даёт только тест'}</dd>
          <dt>Направление</dt>
          <dd>{c.specialization ? SPEC_LABEL[c.specialization] : '–'}</dd>
          <dt>ФСП</dt>
          <dd>{FSP_LABEL[c.fspState]}</dd>
          <dt>Приватность</dt>
          <dd>{c.hiddenFromEmployers ? 'скрыт от работодателей' : 'виден работодателям под псевдонимом'}</dd>
          <dt>Учётка</dt>
          <dd>
            {c.account ? (
              <Link href={`/admin/users/${c.account.id}`}>{c.account.id}</Link>
            ) : (
              'нет'
            )}
            {c.account?.blocked && <Tag tone="dashed">заблокирован</Tag>}
          </dd>
          <dt>Создан</dt>
          <dd>{fmtDateTime(c.createdAt)}</dd>
        </dl>
        <div className={styles.row}>
          {c.isDemo && <Tag>демо</Tag>}
        </div>
        <RevealPii url={`/api/admin/candidates/${c.id}/pii`} canReveal={can(staff.role, 'reveal_pii')} />
      </Panel>

      {c.profile && (
        <Panel className={styles.section}>
          <h2 className={styles.sectionTitle}>Анкета</h2>
          <dl className={styles.kv}>
            <dt>Цель</dt>
            <dd>{c.profile.goal ?? '–'}</dd>
            <dt>Заявленный грейд</dt>
            <dd>{c.profile.claimedGrade ? GRADE_LABEL[c.profile.claimedGrade] : '–'}</dd>
            <dt>Стек</dt>
            <dd>{c.profile.stack.join(', ') || '–'}</dd>
            <dt>Город</dt>
            <dd>{c.profile.city ?? '–'}</dd>
            <dt>Стаж</dt>
            <dd>{c.profile.experienceYears ?? '–'}</dd>
          </dl>
        </Panel>
      )}

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Тесты и попытки</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Начата</th>
              <th>Вид</th>
              <th>Заявлено</th>
              <th>Итог</th>
              <th>Честность</th>
            </tr>
          </thead>
          <tbody>
            {c.testAttempts.map((a) => (
              <tr key={a.id}>
                <td className={styles.mono}>{fmtDateTime(a.startedAt)}</td>
                <td>{a.kind === 'confirm' ? 'подтверждающий' : 'на грейд'}{a.mode === 'demo' ? ' (демо)' : ''}</td>
                <td>{`${SPEC_LABEL[a.specialization]} · ${GRADE_LABEL[a.grade]}`}</td>
                <td>{ATTEMPT_STATUS_LABEL[a.status]}</td>
                <td className={styles.mono}>{integrityLevel(a.integrity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.testAttempts.length === 0 && <p className={styles.muted}>Попыток нет.</p>}
        {c.categories.length > 1 && (
          <p className={styles.muted}>
            История категорий: {c.categories.map((k) => `${SPEC_LABEL[k.specialization]} ${GRADE_LABEL[k.grade]} (${fmtDate(k.confirmedAt)})`).join(' → ')}
          </p>
        )}
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Утверждения ({c.claims.length})</h2>
        <p className={styles.muted}>
          Уровни доказательности: {Object.entries(c.claimsByLevel).map(([k, n]) => `${EVIDENCE_LABEL[k] ?? k} ${n}`).join(', ') || '–'}
        </p>
        <table className={styles.table}>
          <tbody>
            {c.claims.map((cl) => (
              <tr key={cl.id}>
                <td className={styles.mono}>{cl.catalogId}</td>
                <td>{cl.statement}</td>
                <td>{EVIDENCE_LABEL[cl.level]}</td>
                <td>{CLAIM_STATUS_LABEL[cl.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Согласия</h2>
        <table className={styles.table}>
          <tbody>
            {c.consents.map((k) => (
              <tr key={k.id}>
                <td>{CONSENT_LABEL[k.kind] ?? k.kind}</td>
                <td className={styles.mono}>{k.version}</td>
                <td className={styles.mono}>{fmtDateTime(k.acceptedAt)}</td>
                <td>{k.active ? 'действует' : `отозвано ${fmtDateTime(k.revokedAt)}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.consents.length === 0 && <p className={styles.muted}>Согласий нет.</p>}
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Приглашения ({c.invitations.length})</h2>
        <table className={styles.table}>
          <tbody>
            {c.invitations.map((i) => (
              <tr key={i.id}>
                <td className={styles.mono}>
                  <Link href={`/admin/invitations/${i.id}`}>{fmtDate(i.createdAt)}</Link>
                </td>
                <td>{i.company ? <Link href={`/admin/companies/${i.company.id}`}>{companyDisplayName(i.company.name)}</Link> : '–'}</td>
                <td>{i.vacancy?.title ?? 'без потребности'}</td>
                <td>{fmtMoney(i.salaryFrom, i.salaryTo)}</td>
                <td>{INVITATION_STATUS_LABEL[i.status]}</td>
                <td>{i.complaint ? `жалоба: ${COMPLAINT_STATUS_LABEL[i.complaint.status]}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {c.invitations.length === 0 && <p className={styles.muted}>Приглашений нет.</p>}
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Жалобы и возражения</h2>
        <ul>
          {c.complaints.map((k) => (
            <li key={k.id}>
              Жалоба на <Link href={`/admin/invitations/${k.invitationId}`}>приглашение</Link>: {COMPLAINT_REASON_LABEL[k.reason]}, {COMPLAINT_STATUS_LABEL[k.status]}, {fmtDate(k.createdAt)}
            </li>
          ))}
          {c.objections.map((o) => (
            <li key={o.id}>
              Возражение ({OBJECTION_SUBJECT_LABEL[o.subject]}): {o.status === 'open' ? `открыто, срок ответа до ${fmtDate(objectionDeadline(o.createdAt))}` : `отвечено ${fmtDate(o.answeredAt)}`}
            </li>
          ))}
        </ul>
        {c.complaints.length + c.objections.length === 0 && <p className={styles.muted}>Нет.</p>}
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Созвоны, защиты, самоотклики</h2>
        <ul>
          {c.callSessions.map((s) => (
            <li key={s.id}>
              Созвон «{CALL_KIND_LABEL[s.kind]}»{s.aiDefense ? ' (ИИ)' : ''}: {s.status}, {fmtDateTime(s.startedAt)}
            </li>
          ))}
          {c.defenseSessions.map((s) => (
            <li key={s.id}>
              Защита утверждения {s.claim.catalogId}: {s.status}, {fmtDateTime(s.createdAt)}
            </li>
          ))}
          {c.applications.map((a) => (
            <li key={a.id}>
              Самоотклик на <Link href={`/admin/vacancies/${a.vacancy.id}`}>{a.vacancy.title}</Link>: {a.status}, {fmtDate(a.createdAt)}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className={styles.actions}>
        <h2 className={styles.sectionTitle}>Действия</h2>
        <CandidateActions candidateId={c.id} hiddenByModerator={hiddenByModerator} can={{ hide: can(staff.role, 'hide_candidate'), resetCooldown: can(staff.role, 'reset_cooldown') }} />
        {c.account && (
          <UserActions
            userId={c.account.id}
            block={{ blockedAt: c.account.blockedAt?.toISOString() ?? null, blockedUntil: c.account.blockedUntil?.toISOString() ?? null, blockedReason: c.account.blockedReason }}
            can={{ block: can(staff.role, 'block_user'), unblock: can(staff.role, 'unblock_user'), erase: can(staff.role, 'erase_account') }}
          />
        )}
      </Panel>
    </>
  );
}
