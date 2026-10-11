'use client';

import Link from 'next/link';
import { specLabel } from '@/lib/directions';
import { claimTopics } from '@/lib/claim-topics';
import { shownWording } from '@/lib/claims-view';
import { stripLimitsPrefix } from '@/lib/plural';
import { useEffect, useState } from 'react';

import { ApiError, type AttemptSummary, claimAction, getProfile, listTestAttemptsApi, request } from '@/lib/api';
import { formatDate, LEVEL_HINT, LEVELS_TOP_DOWN } from '@/lib/labels';
import type { ProfileClaim, ProfileView } from '@/server/claims/types';

import { ProfileBasics, ProfilePublicPreview } from './candidate/ProfileCards';
import { ResumeFieldsCard } from '@/components/candidate/ResumeFields';
import type { ProfileDetails } from '@/server/claims/profile-details';
import { LevelBadge } from './LevelBadge';
import { Button, Kicker, Notice } from './ui';
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
            </Link>
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
  const [error, setError] = useState<ApiError | Error | null>(null);

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

  async function editClaim(id: string, statement: string) {
    await claimAction(id, 'edit', statement);
    const [p, d] = await Promise.all([getProfile(), request<ProfileDetails>('/api/profile/details').catch(() => null)]);
    setProfile(p);
    setDetails(d?.employerPreview ? d : null);
  }

  // ?print=1 (ссылка render_profile_pdf консультанта) — открыть печать, когда профиль загружен.
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



  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div><Kicker>Ваш опыт и доказательства</Kicker><h1>Профиль<i>.</i></h1><p>У каждого факта есть источник: достижение, проверка платформой или ваши слова. Компании видят, откуда что взялось.</p></div>
        <div className={`${styles.actions} ${styles.noPrint}`}><Button href="/consultant">↑ Обновить резюме</Button><Button onClick={() => window.print()}>↓ PDF-профиль</Button></div>
      </header>
      <aside className={styles.side} aria-label="Так вас видит компания">
        <ProfilePublicPreview details={details} />
        <div className={styles.sideActions}><Button href="/skills">Навыки и грейд →</Button><Button href="/projects">Проектные задания →</Button></div>
      </aside>

      <div className={styles.main}>
      <ProfileBasics details={details} name={profile.candidate.name} />
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
      <details className={styles.extraEvidence}><summary>История проверок</summary><TestHistory attempts={attempts} /></details>
      <div className={`${styles.noPrint} ${styles.homeLinks}`}>
        <Link href="/skills">Карта глубины и пробелы → Навыки и грейд</Link>
        <Link href="/career">Подходящие вакансии → Моя карта</Link>
      </div>
      <div className={`${styles.visibility} ${styles.noPrint}`}>
        <h2>Что видят компании</h2>
        <p className={ui.muted}>Имя, контакт и цитаты из резюме скрыты. После принятия приглашения имя и контакт открываются только этой компании.</p>
        <Button size="sm" href="/settings">Настроить видимость профиля ↗</Button>
      </div>
      </div>
    </div>
  );
}
