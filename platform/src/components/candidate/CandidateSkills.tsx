'use client';

import { useEffect, useState } from 'react';
import { getProfile, getRecommendations, listTestAttemptsApi, request, type AttemptSummary, type RecommendationsView } from '@/lib/api';
import { specLabel } from '@/lib/directions';
import { gradeLabel } from '@/lib/grades';
import { formatDate } from '@/lib/labels';
import type { ProfileView } from '@/server/claims/types';
import type { ProfileDetails } from '@/server/claims/profile-details';
import { DepthMapSection } from '../call/DepthMapSection';
import { Button, Notice, Panel } from '../ui';
import styles from './Candidate.module.css';

const EVIDENCE: Record<string, string> = { self_reported: 'Со слов', artifact: 'Артефакт', third_party: 'Внешний источник', platform: 'Проверено платформой' };
export function proofLabels(proofs: string[]): string {
  const labels = proofs.map((proof) => {
    if (proof.startsWith('task:')) return 'Практическое задание';
    if (proof.startsWith('interview:')) return 'Разбор утверждения с консультантом';
    if (proof.startsWith('registry:fsp')) return 'Достижения ФСП';
    if (proof.startsWith('registry:')) return 'Подтверждение внешним источником';
    if (proof.startsWith('artifact:') || proof.startsWith('repo:') || proof.startsWith('link:')) return 'Артефакт: код или материал работы';
    return proof.includes(':') ? 'Подтверждающий материал' : proof;
  });
  return [...new Set(labels)].join(', ') || 'Обсудить с консультантом';
}
export function recommendationTargetLabel(recs: RecommendationsView): string {
  const [kind, id, grade] = (recs.target ?? '').split(':');
  if (kind === 'category' && id && grade) return `${specLabel(id)} · ${gradeLabel(grade)}`;
  if (kind === 'vacancy' && id) {
    const vacancy = recs.targets?.find((row) => row.vacancyId === id);
    return vacancy ? `${vacancy.companyName} · ${vacancy.title}` : 'Требования выбранной вакансии';
  }
  return 'Цель не выбрана';
}
export function CandidateSkills() {
  const [state, setState] = useState<{ profile: ProfileView; details: ProfileDetails; recs: RecommendationsView; attempts: AttemptSummary[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let alive = true; Promise.all([getProfile(), request<ProfileDetails>('/api/profile/details'), getRecommendations(), listTestAttemptsApi()]).then(([profile, details, recs, attempts]) => { if (alive) setState({ profile, details, recs, attempts }); }, (err: Error) => alive && setError(err.message)); return () => { alive = false; }; }, []);
  const spec = state?.profile.category?.specialization ?? state?.profile.candidate.specialization;
  const grade = state?.profile.category?.grade ?? state?.details.basics?.claimedGrade;
  const testHref = spec ? `/test?specialization=${spec}${grade ? `&grade=${grade}` : ''}` : '/test';
  return <div className={styles.page}>
    <header className={styles.heading}><h1>Навыки и грейд<i>.</i></h1><p>Категория - это специализация и грейд. По ней вас находят компании, и даёт её только тест, а не резюме.</p></header>
    {error ? <Notice tone="error">{error}</Notice> : !state ? <p role="status">Загружаем навыки…</p> : <>
      <div className={styles.skillsSummary}>
        <Panel className={styles.summaryCard}><span>Категория</span><b>{spec ? specLabel(spec) : 'Не выбрана'}{grade ? ` · ${gradeLabel(grade)}` : ''}</b><small className={styles.claimedGrade}>{state.profile.category ? 'подтверждена тестом' : 'со слов · тест не пройден'}</small><Button size="sm" href={testHref}>Пройти тест →</Button></Panel>
        <Panel className={styles.summaryCard}><span>С доказательством</span><b>{state.profile.claims.filter((claim) => claim.status !== 'rejected' && claim.status !== 'proposed' && claim.level !== 'self_reported').length} из {state.profile.claims.filter((claim) => claim.status !== 'rejected' && claim.status !== 'proposed').length}</b><div className={styles.evidenceSegments} aria-hidden="true">{state.profile.claims.filter((claim) => claim.status !== 'rejected' && claim.status !== 'proposed').map((claim) => <i key={claim.id} data-proven={claim.level !== 'self_reported'} />)}</div><small>Артефакт, внешний источник или проверка платформой</small></Panel>
        <Panel className={styles.summaryCard}><span>Цель</span><b>{recommendationTargetLabel(state.recs)}</b><small>Требования выбранной цели</small><Button size="sm" href="/saved">Смотреть избранное →</Button></Panel>
      </div>
      <div className={styles.skillsColumns}>
        <Panel className={styles.basicCard}><div className={styles.sectionLabel}><span>Карта пробелов к цели</span><small>{recommendationTargetLabel(state.recs)}</small></div>
          {state.recs.gaps?.length ? <div className={styles.gapTable}><div className={styles.gapHeader}><span>Что нужно</span><span>Сейчас</span><span>Чем доказать</span></div>{state.recs.gaps.map((gap) => <div key={gap.id} className={styles.gapRow}><b>{gap.statement}</b><span className={styles.gapStatus} data-missing={!gap.currentLevel}><i />{gap.currentLevel ? EVIDENCE[gap.currentLevel] : 'Нет'}</span><span>{proofLabels(gap.suggestedProof)}</span></div>)}</div> : <p className={styles.meta}>Карта появится после выбора цели у консультанта.</p>}
          <div className={styles.actions}><Button variant="cta" href="/projects">Проектные задания →</Button><Button size="sm" href="/consultant">Разобрать пробелы ↗</Button></div>
        </Panel>
        <div className={styles.stack}><Panel className={styles.basicCard}><div className={styles.sectionLabel}>Карта глубины</div><p>Созвон помогает проверить глубину навыков по темам вашего опыта.</p><DepthMapSection /><Button href="/consultant?call=1">Созвониться</Button></Panel><Panel className={styles.basicCard}><div className={styles.sectionLabel}>История опроса и тестов</div><ol className={styles.skillsHistory}>{state.attempts.length ? state.attempts.map((attempt) => <li key={attempt.id}><i /><div><small>{formatDate(attempt.startedAt)}</small><b>Тест {specLabel(attempt.specialization)} · {gradeLabel(attempt.grade)}</b><span>{attempt.status === 'passed' ? 'Грейд подтверждён' : attempt.status === 'active' ? 'Не завершён' : attempt.status === 'abandoned' ? 'Попытка не засчитана' : 'Грейд не подтверждён'}</span><a href={`/test?attempt=${encodeURIComponent(attempt.id)}`}>Открыть попытку →</a></div></li>) : <li><i /><div><b>Тест на грейд</b><span>Ещё не проходили</span><a href={testHref}>Начать тест →</a></div></li>}</ol></Panel></div>
      </div>
      <Panel className={styles.basicCard}><div className={styles.sectionLabel}>Дальше - подтверждение на практике</div><p>Квалифицирующий созвон, проектное задание и защита помогают показать глубину навыков. Ваши предыдущие результаты сохраняются.</p><div className={styles.actions}><Button href="/consultant">Созвон с консультантом</Button><Button href="/projects">Проектные задания</Button><Button href="/defense-room">Защита проекта</Button></div></Panel>
    </>}
  </div>;
}
