'use client';

import Link from 'next/link';
import { gradeLabel } from '@/lib/grades';
import { specLabel } from '@/lib/directions';
import { claimTopics } from '@/lib/claim-topics';
import { shownWording } from '@/lib/claims-view';
import { stripLimitsPrefix } from '@/lib/plural';
import { useEffect, useState } from 'react';

import { ApiError, type AttemptSummary, claimAction, getProfile, listOnboardingHistoryApi, listTestAttemptsApi, request } from '@/lib/api';
import type { AnswerRevisionView } from '@/server/onboarding/types';
import { formatDate, LEVEL_HINT, LEVELS_TOP_DOWN } from '@/lib/labels';
import type { ProfileClaim, ProfileView } from '@/server/claims/types';

import { ProfilePublicPreview } from './candidate/ProfileCards';
import { ProfileForm } from './candidate/ProfileForm';
import { onboardingAct } from '@/lib/api';
import { ResumeFieldsCard } from '@/components/candidate/ResumeFields';
import type { ProfileDetails } from '@/server/claims/profile-details';
import { LevelBadge } from './LevelBadge';
import { Button, Kicker, Notice, Panel } from './ui';
import styles from './ProfilePage.module.css';
import ui from './ui.module.css';

const STATUS_NOTE = { proposed: 'ждёт вашего подтверждения', edited: 'исправлено вами' } as const;

function ClaimItem({ claim, onDecide, onEdit }: { claim: ProfileClaim; onDecide?: (id: string, action: 'confirm' | 'reject') => Promise<void>; onEdit?: (id: string, statement: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const shown = shownWording(claim);
  const topics = claim.wording && claim.status !== 'edited' && claim.statement !== shown ? claimTopics([{ statement: claim.statement, quote: claim.quote ?? '' }]) : '';
  const [statement, setStatement] = useState(shown);
  async function save() {
    if (!onEdit || !statement.trim()) return;
    setBusy(true);
    setErr(null);
    try { await onEdit(claim.id, statement.trim()); setEditing(false); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Не удалось сохранить.'); }
    finally { setBusy(false); }
  }
  async function decide(action: 'confirm' | 'reject') {
    if (!onDecide) return;
    setBusy(true);
    setErr(null);
    try {
      await onDecide(claim.id, action);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Не удалось сохранить.');
    } finally {
      // Элемент после «Да» остаётся на экране: без сброса «Сохранить формулировку» крутится до перезагрузки.
      setBusy(false);
    }
  }
  const provable = claim.level === 'self_reported' || claim.level === 'artifact';
  return (
    <li className={`${ui.panel} ${styles.claim}`}>
      <p className={styles.statement}>{shown}</p>
      {editing && <form className={styles.editClaim} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <label htmlFor={`edit-${claim.id}`}>Уточните формулировку</label>
        <textarea id={`edit-${claim.id}`} className={ui.input} value={statement} maxLength={300} minLength={3} rows={3} onChange={(event) => setStatement(event.target.value)} />
        <div className={styles.actions}><Button type="submit" size="sm" loading={busy} disabled={statement.trim().length < 3}>Сохранить формулировку</Button><Button size="sm" onClick={() => { setEditing(false); setStatement(shown); }}>Отмена</Button></div>
      </form>}
      {claim.quote && <p className={styles.quote}>«{claim.quote}»</p>}
      <div className={styles.meta}>
        <span>Источник: {claim.sourceRef || claim.sourceKind}</span>
        {topics && <span>На созвоне спросим про: {topics}</span>}
        <span>Дата: {formatDate(claim.confirmedAt ?? claim.createdAt)}</span>
        {(claim.status === 'proposed' || claim.status === 'edited') && <span>{STATUS_NOTE[claim.status]}</span>}
      </div>
      {claim.limits && (
        <div className={styles.meta}>
          <span>Не доказывает: {stripLimitsPrefix(claim.limits)}</span>
        </div>
      )}
      {claim.status === 'proposed' && onDecide && (
        <div className={`${styles.actions} ${styles.noPrint}`} role="group" aria-label="Это про вас?">
          <button type="button" className={`${ui.btn} ${ui.small}`} disabled={busy} onClick={() => void decide('confirm')}>
            Да
          </button>
          <button type="button" className={`${ui.btn} ${ui.small}`} disabled={busy} onClick={() => void decide('reject')}>
            Нет
          </button>
        </div>
      )}
      {provable && (
        <div className={`${styles.actions} ${styles.noPrint}`}>
          <Link className={`${ui.btn} ${ui.small}`} href={`/defense/${encodeURIComponent(claim.id)}`}>
            Разобрать с консультантом
          </Link>
        </div>
      )}
      {onEdit && !editing && <div className={`${styles.actions} ${styles.noPrint}`}><Button size="sm" onClick={() => setEditing(true)}>Изменить формулировку</Button></div>}
      {err && <Notice tone="error">{err}</Notice>}
    </li>
  );
}

const ATTEMPT_STATUS: Record<AttemptSummary['status'], string> = {
  active: 'не завершена',
  passed: 'подтверждён',
  not_confirmed: 'не подтверждён',
  abandoned: 'не засчитана',
  needs_confirmation: 'нужен подтверждающий тест',
};

/**
 * Категория записана, но выдача работодателя её не учитывает (индекс честности, аудит 11.10): говорим прямо,
 * без уровня и причин, и ведём к попытке - там подтверждающий тест, созвон и возражение.
 */
function RankingHoldNotice({ attempts }: { attempts: AttemptSummary[] }) {
  const held = attempts.find((a) => a.rankingHold);
  if (!held) return null;
  return (
    <Notice className={styles.noPrint} data-testid="ranking-hold-notice">
      Категория по тесту от {formatDate(held.startedAt)} записана, но в подборках и поиске компаний пока не учитывается: нужен короткий подтверждающий
      тест или созвон с ИИ с разбором этой попытки. Это не снятие грейда.{' '}
      <Link href={`/test?attempt=${encodeURIComponent(held.id)}`} style={{ textDecoration: 'underline' }}>Открыть попытку и подтвердить</Link>
    </Notice>
  );
}

/** История попыток теста (R-C-07, lane test). Данные — /api/test/attempts; недоступны → блок пустой. */
function TestHistory({ attempts }: { attempts: AttemptSummary[] }) {
  if (attempts.length === 0) return null;
  return (
    <div className={styles.testRec} data-testid="test-history">
      <span className={ui.kicker}>История тестов</span>
      <ul className={styles.history}>
        {attempts.slice(0, 5).map((a) => (
          <li key={a.id}>
            <Link href={`/test?attempt=${encodeURIComponent(a.id)}`}>
              {formatDate(a.startedAt)}: {specLabel(a.specialization)} · {a.grade} - {ATTEMPT_STATUS[a.status]}
              {a.juniorConfirmedAt ? ', Junior подтверждён' : ''}
              {a.status !== 'active' && a.status !== 'abandoned' ? ` (${a.correct} из ${a.answered})` : ''}
              {a.rankingHold ? ' - в подборках пока не учитывается' : ''}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** История ответов опроса (C05): «было → стало» по шагам. Данные — /api/onboarding/history; недоступны → блок пустой. */
function OnboardingHistory({ revisions }: { revisions: AnswerRevisionView[] }) {
  if (revisions.length === 0) return null;
  return (
    <div className={styles.testRec} data-testid="onboarding-history">
      <span className={ui.kicker}>История ответов опроса</span>
      <ul className={styles.history}>
        {revisions.slice(0, 20).map((r) => (
          <li key={r.id}>
            {formatDate(r.createdAt)}: {r.label} - {r.previous ?? 'не было'} → {r.value ?? 'удалено'}
            {r.source === 'reset' ? ' (сброс опроса)' : r.source === 'fsp' ? ' (вход через ФСП ID)' : ''}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProfilePage() {
  const [details, setDetails] = useState<ProfileDetails | null>(null);
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [revisions, setRevisions] = useState<AnswerRevisionView[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);
  const [tipHidden, setTipHidden] = useState(false);

  useEffect(() => {
    let alive = true;
    getProfile().then(
      (p) => alive && setProfile(p),
      (e: Error) => alive && setError(e),
    );
    request<ProfileDetails>('/api/profile/details').then((value) => { if (alive && value.employerPreview) setDetails(value); }, () => undefined);
    listTestAttemptsApi().then(
      (a) => alive && setAttempts(a),
      () => undefined,
    );
    listOnboardingHistoryApi().then(
      (r) => alive && setRevisions(r),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  /** Да / Нет на черновике: действие на сервере, затем обновляем список и карту пробелов без перезагрузки. */
  async function decide(id: string, action: 'confirm' | 'reject') {
    await claimAction(id, action);
    const [p, d] = await Promise.all([getProfile(), request<ProfileDetails>('/api/profile/details').catch(() => null)]);
    setProfile(p);
    setDetails(d?.employerPreview ? d : null);
  }

  /** После автосохранения поля формы: свежие профиль и детали (заполненность, подсказки, категория). */
  async function refresh() {
    const [p, d] = await Promise.all([getProfile(), request<ProfileDetails>('/api/profile/details').catch(() => null)]);
    setProfile(p);
    setDetails(d?.employerPreview ? d : null);
  }

  async function editClaim(id: string, statement: string) {
    await claimAction(id, 'edit', statement);
    const [p, d] = await Promise.all([getProfile(), request<ProfileDetails>('/api/profile/details').catch(() => null)]);
    setProfile(p);
    setDetails(d?.employerPreview ? d : null);
  }

  // ?print=1 — запасная печать страницы браузером, когда профиль загружен (основной PDF — файл /api/profile/pdf).
  useEffect(() => {
    if (!profile) return;
    if (new URLSearchParams(window.location.search).get('print') === '1') window.print();
  }, [profile]);

  if (error) {
    const unauth = error instanceof ApiError && error.status === 401;
    return (
      <div className={styles.pageSingle}>
        <Notice tone="error">{error.message}</Notice>
        {unauth && (
          <Button size="sm" href="/" style={{ justifySelf: 'start' }}>
            На страницу входа
          </Button>
        )}
      </div>
    );
  }
  if (!profile) {
    return (
      <div className={styles.pageSingle} aria-busy="true">
        <p className={ui.muted} role="status">
          <span className={ui.spinner} aria-hidden="true" /> Загружаю профиль…
        </p>
      </div>
    );
  }

  const claims = profile.claims.filter((c) => c.status !== 'rejected');
  const filled = details?.completion?.filled ?? 0;
  const total = details?.completion?.total ?? 0;
  const completion = total > 0 ? Math.round(filled / total * 100) : 0;
  const missing = details?.completion?.missing ?? [];
  const claimed = details?.basics?.claimedGrade ?? null;
  const tips = tipHidden ? [] : (details?.suggestions ?? []).slice(0, 2);
  const tip = tips[0];
  const tipNames = tips.map((g) => g.name).join(' и ');
  const sourceGroups = [
    { label: 'Резюме', mark: '↑', kind: 'resume' },
    { label: 'GitHub', mark: '⌘', kind: 'github' },
    { label: 'ФСП ID', mark: '✳', kind: 'fsp' },
  ];



  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div><h1>Профиль<i>.</i></h1><p>Чем полнее профиль, тем точнее подбор.</p></div>
      </header>
      <aside className={styles.side} aria-label="Так вас видит компания">
        <Panel className={styles.railCard}>
          <div className={styles.railLabel}><span>Заполненность профиля</span><b>{total ? `${completion}%` : '-'}</b></div>
          <div className={styles.completionTrack} role="progressbar" aria-label="Заполненность профиля" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion}><i style={{ width: `${completion}%` }} /></div>
          <p>{total ? `Заполнено ${filled} из ${total} полей` : 'Данные заполненности пока недоступны'}</p>
          {missing.length > 0 && <div className={styles.missingChips}>{missing.map((m) => <span key={m}>+ {m}</span>)}</div>}
        </Panel>
        <Panel className={styles.railCard}>
          <Kicker>Категория</Kicker>
          <h2>{profile.category ? `${specLabel(profile.category.specialization)} · ${gradeLabel(profile.category.grade)}` : details?.specialization ? `${specLabel(details.specialization)}${claimed ? ` · ${gradeLabel(claimed)}` : ''}` : 'Ещё не выбрана'}</h2>
          {profile.category ? <p>Подтверждена тестом {formatDate(profile.category.confirmedAt)}</p> : <span className={styles.unconfirmed}>не подтверждена тестом</span>}
          <Button variant="cta" href="/test">Пройти тест · 25 мин</Button>
        </Panel>
        <div className={styles.kiraCard}>
          <div className={styles.kiraHead}><span className={styles.kiraAvatar} aria-hidden="true">К</span><div><b>Консультант</b><small>смотрит резюме и GitHub</small></div></div>
          {tip ? <>
            <p>В {tip.from === 'github' ? 'GitHub' : 'резюме'} нашла {tipNames}. Добавить в навыки?</p>
            <div className={styles.kiraActions}><button type="button" className={styles.kiraYes} onClick={() => void onboardingAct({ action: 'answer', stepId: 'stack', value: [...(details?.basics?.stack ?? []), ...tips.map((g) => g.name)] }).then(refresh)}>Добавить</button><button type="button" onClick={() => setTipHidden(true)}>Позже</button></div>
          </> : <p>Готово. Следующий шаг - тест на грейд.</p>}
          <Link href="/consultant" className={styles.kiraLink}>Открыть чат ↗</Link>
        </div>
        <a className={`${ui.btn} ${styles.noPrint}`} href="/api/profile/pdf" download="meshwork-profile.pdf" aria-label="PDF-профиль">↓ PDF-профиль</a>
        <details className={styles.previewDisclosure}><summary>Как видит компания</summary><ProfilePublicPreview details={details} /></details>
      </aside>

      <div className={styles.main}>
      <div className={styles.sourceTiles} aria-label="Источники профиля">{sourceGroups.map((source) => {
        const evidence = claims.filter((claim) => claim.sourceKind === source.kind);
        const origins = [...new Set(evidence.map((claim) => claim.sourceRef.split('#')[0]).filter(Boolean))];
        return <Button href="/consultant" key={source.kind} className={styles.sourceTile}><span className={styles.sourceMark} aria-hidden="true">{source.mark}</span><span><b>{source.label}</b><small>{source.kind === 'fsp' ? `${details?.fspState === 'not_linked' || !details ? 'Не подключён' : 'Симулятор ФСП ID'} · ${evidence.length} утверждений` : origins.length ? `${origins.length} источников · ${evidence.length} утверждений` : 'Добавить источник'}</small></span></Button>;
      })}</div>
      <RankingHoldNotice attempts={attempts} />
      <ProfileForm details={details} name={profile.candidate.name} claims={claims} onSaved={refresh} />
      <details className={styles.extraEvidence}><summary>Утверждения о навыках и данные из резюме · {claims.length}</summary>
      <ResumeFieldsCard details={details} />
      <section className={styles.evidencePanel} aria-label="Утверждения о навыках"><header><h2>Утверждения о навыках</h2><span>Уровень доказанности</span></header>
      {claims.length === 0 ? (
        <div className={`${ui.panel}`}>
          <p>Утверждений пока нет.</p>
          <p className={ui.muted}>
            <Link href="/consultant" style={{ textDecoration: 'underline' }}>
              Пришлите резюме консультанту
            </Link>
            , и он соберёт первые.
          </p>
        </div>
      ) : (
        LEVELS_TOP_DOWN.map((level) => {
          const list = claims.filter((c) => c.level === level);
          if (list.length === 0) return null;
          return (
            <section key={level} className={styles.section} aria-labelledby={`lvl-${level}`}>
              <h2 id={`lvl-${level}`}>
                <LevelBadge level={level} />
                <span className={styles.count}>
                  {list.length} · {LEVEL_HINT[level]}
                </span>
              </h2>
              <ul className={styles.list}>
                {list.map((c) => (
                  <ClaimItem key={c.id} claim={c} onDecide={decide} onEdit={editClaim} />
                ))}
              </ul>
            </section>
          );
        })
      )}
      </section>
      </details>
      <details className={styles.extraEvidence}><summary>История проверок</summary><TestHistory attempts={attempts} /><OnboardingHistory revisions={revisions} /></details>
      </div>
    </div>
  );
}
