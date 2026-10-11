import Link from 'next/link';

import { FSP_LABEL, GRADE_LABEL, OBJECTION_SUBJECT_LABEL, SPEC_LABEL, USER_ROLE_LABEL, fmtDate, pct } from '@/components/admin/labels';
import { Notice, Panel } from '@/components/ui';
import { loadDashboard } from '@/server/admin/overview/dashboard';
import { STAFF_ROLE_LABEL } from '@/server/admin/permissions';
import { requirePageStaff } from '@/server/admin/session';

import styles from './admin.module.css';

const GRADES = ['junior', 'middle', 'senior'] as const;
const SPECS = ['backend', 'frontend', 'ai', 'engineering'] as const;

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Panel className={styles.stat}>
      <span className={styles.muted}>{label}</span>
      <span className={styles.statValue}>{value}</span>
      {hint && <span className={styles.muted}>{hint}</span>}
    </Panel>
  );
}

/** Дашборд: счётчики платформы, воронка приглашений, очереди со сроками, расход LLM за сутки. */
export default async function AdminHomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const staff = await requirePageStaff('/admin', 'view_dashboard');
  const { denied } = await searchParams;
  const d = await loadDashboard();
  const cell = (spec: string, grade: string) => d.candidates.byCategory.find((c) => c.specialization === spec && c.grade === grade)?.count ?? 0;
  const days = [...new Set(d.users.perDay.map((r) => r.day))];
  const perDay = (day: string, role: string) => d.users.perDay.find((r) => r.day === day && r.role === role)?.count ?? 0;
  return (
    <>
      <h1 className={styles.title}>Обзор</h1>
      {denied && <Notice tone="error">Раздел недоступен для роли «{STAFF_ROLE_LABEL[staff.role]}».</Notice>}
      <p className={styles.muted}>
        {staff.name}, вы вошли как «{STAFF_ROLE_LABEL[staff.role]}». Разделы слева открыты по правам роли; каждое действие пишется в журнал.
      </p>

      <div className={styles.stats}>
        <Stat label="Пользователи" value={d.users.total} hint={Object.entries(d.users.byRole).map(([r, n]) => `${USER_ROLE_LABEL[r] ?? r} ${n}`).join(', ')} />
        <Stat label="Кандидаты" value={d.candidates.total} hint={`с категорией ${d.candidates.categorized}`} />
        <Stat label="Без истории ФСП" value={pct(d.candidates.withoutFspShare)} hint={`${d.candidates.withoutFspHistory} кандидатов (${FSP_LABEL.not_linked} и др.)`} />
        <Stat label="Компании" value={d.companies.total} hint={`проверено ${d.companies.verified}, заблокировано ${d.companies.blocked}`} />
        <Stat label="LLM за 24 часа" value={`${d.llm24h.tokens.toLocaleString('ru-RU')} ток.`} hint={`${d.llm24h.calls} вызовов; подробности — в метриках`} />
      </div>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Кандидаты по категориям</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Направление</th>
              {GRADES.map((g) => (
                <th key={g}>{GRADE_LABEL[g]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SPECS.map((s) => (
              <tr key={s}>
                <td>{SPEC_LABEL[s]}</td>
                {GRADES.map((g) => (
                  <td key={g}>
                    <Link href={`/admin/candidates?specialization=${s}&grade=${g}`}>{cell(s, g)}</Link>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Воронка приглашений</h2>
        <table className={styles.table}>
          <tbody>
            <tr>
              <td>Отправлено</td>
              <td>{d.funnel.sent}</td>
              <td />
            </tr>
            <tr>
              <td>Просмотрено</td>
              <td>{d.funnel.viewed}</td>
              <td>{pct(d.funnel.sent ? d.funnel.viewed / d.funnel.sent : null)}</td>
            </tr>
            <tr>
              <td>Принято (включая найм)</td>
              <td>{d.funnel.accepted}</td>
              <td>{pct(d.funnel.sent ? d.funnel.accepted / d.funnel.sent : null)}</td>
            </tr>
            <tr>
              <td>Отклонено</td>
              <td>{d.funnel.declined}</td>
              <td>{pct(d.funnel.sent ? d.funnel.declined / d.funnel.sent : null)}</td>
            </tr>
            <tr>
              <td>Отозвано или закрыто наймом</td>
              <td>{d.funnel.withdrawn}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Очереди и сроки</h2>
        <p>
          Открытых жалоб: {d.moderation.openComplaints}
          {d.moderation.oldestComplaintHours !== null && `, самой старой ${d.moderation.oldestComplaintHours} ч`}.
        </p>
        <p>Открытых возражений кандидатов: {d.moderation.openObjectionsTotal}. Срок ответа — 30 дней (152-ФЗ, ст. 16).</p>
        <ul>
          {d.moderation.openObjections.map((o) => (
            <li key={o.id}>
              {OBJECTION_SUBJECT_LABEL[o.subject]}, подано {fmtDate(o.createdAt)}: {o.hoursLeft >= 0 ? `осталось ${o.hoursLeft} ч` : `просрочено на ${-o.hoursLeft} ч`}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel className={styles.section}>
        <h2 className={styles.sectionTitle}>Регистрации за {d.users.days} дней (МСК)</h2>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>День</th>
              <th>Кандидаты</th>
              <th>Работодатели</th>
              <th>Без роли</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day}>
                <td className={styles.mono}>{day}</td>
                <td>{perDay(day, 'candidate')}</td>
                <td>{perDay(day, 'employer')}</td>
                <td>{perDay(day, 'pending')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {days.length === 0 && <p className={styles.muted}>Регистраций за период нет.</p>}
      </Panel>
    </>
  );
}
