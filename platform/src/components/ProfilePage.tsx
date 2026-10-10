'use client';

import Link from 'next/link';
import { specLabel } from '@/lib/directions';
import { stripLimitsPrefix } from '@/lib/plural';
import { useEffect, useState } from 'react';

import { ApiError, type AttemptSummary, claimAction, getProfile, getRecommendations, listTestAttemptsApi, type RecommendationsView } from '@/lib/api';
import { formatDate, LEVEL_HINT, LEVELS_TOP_DOWN } from '@/lib/labels';
import type { ProfileClaim, ProfileView } from '@/server/claims/types';
import type { Gap } from '@/server/recommend/types';

import { LevelBadge } from './LevelBadge';
import { Button, Notice } from './ui';
import styles from './ProfilePage.module.css';
import ui from './ui.module.css';

const STATUS_NOTE = { proposed: 'ждёт вашего подтверждения', edited: 'исправлено вами' } as const;

function ClaimItem({ claim, onDecide }: { claim: ProfileClaim; onDecide?: (id: string, action: 'confirm' | 'reject') => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
      <p className={styles.statement}>{claim.statement}</p>
      {claim.quote && <p className={styles.quote}>«{claim.quote}»</p>}
      <div className={styles.meta}>
        <span>Источник: {claim.sourceRef || claim.sourceKind}</span>
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
          {err && (
            <span className={ui.muted} role="alert">
              {err}
            </span>
          )}
        </div>
      )}
      {provable && (
        <div className={`${styles.actions} ${styles.noPrint}`}>
          <Link className={`${ui.btn} ${ui.small}`} href={`/defense/${encodeURIComponent(claim.id)}`}>
            Доказать защитой
          </Link>
        </div>
      )}
    </li>
  );
}

function GapMap({ gaps, pending }: { gaps: Gap[]; pending: Set<string> }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.gaps}>
        <caption className={ui.srOnly}>Карта пробелов к цели</caption>
        <thead>
          <tr>
            <th scope="col">Что нужно</th>
            <th scope="col">Сейчас</th>
            <th scope="col">Чем доказать</th>
          </tr>
        </thead>
        <tbody>
          {gaps.map((g) => (
            <tr key={g.id}>
              <td>{g.statement}</td>
              <td>{g.currentLevel ? (
                  <LevelBadge level={g.currentLevel} />
                ) : pending.has(g.catalogId) ? (
                  <span className={ui.muted}>ждёт подтверждения</span>
                ) : (
                  <span className={ui.muted}>нет утверждения</span>
                )}</td>
              <td>{g.suggestedProof.length ? g.suggestedProof.join('; ') : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ATTEMPT_STATUS: Record<AttemptSummary['status'], string> = {
  active: 'не завершена',
  passed: 'подтверждён',
  not_confirmed: 'не подтверждён',
  abandoned: 'не засчитана',
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
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [recs, setRecs] = useState<RecommendationsView | null>(null);
  const [attempts, setAttempts] = useState<AttemptSummary[]>([]);
  const [error, setError] = useState<ApiError | Error | null>(null);

  useEffect(() => {
    let alive = true;
    getProfile().then(
      (p) => alive && setProfile(p),
      (e: Error) => alive && setError(e),
    );
    // карта пробелов — необязательная часть: API рекомендаций может быть недоступен
    getRecommendations().then(
      (r) => alive && setRecs(r),
      () => alive && setRecs({}),
    );
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
    const [p, r] = await Promise.all([getProfile(), getRecommendations().catch(() => null)]);
    setProfile(p);
    if (r) setRecs(r);
  }

  // ?print=1 (ссылка render_profile_pdf консультанта) — открыть печать, когда профиль загружен.
  useEffect(() => {
    if (!profile || recs === null) return;
    if (new URLSearchParams(window.location.search).get('print') === '1') window.print();
  }, [profile, recs]);

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
  const pending = new Set(claims.filter((c) => c.status === 'proposed').map((c) => c.catalogId));
  const gaps = recs?.gaps ?? [];
  const tasks = recs?.tasks ?? [];
  const targets = recs?.targets ?? [];
  const confirmedCount = claims.filter((c) => c.status === 'confirmed' || c.status === 'edited').length;

  const test = recs?.test;

  return (
    <div className={styles.page}>
      <aside className={styles.side} aria-label="Кандидат">
        <div className={styles.me}>
          <span className={`${ui.avatar} ${styles.avatarFrame}`} aria-hidden="true">
            <svg viewBox="0 0 44 44" width="100%" height="100%">
              <circle cx="22" cy="16" r="8" fill="currentColor" />
              <path d="M6 44c1.5-10 8-15 16-15s14.5 5 16 15z" fill="currentColor" />
            </svg>
          </span>
          <div>
            <h1 className={styles.name}>{profile.candidate.name}</h1>
            {profile.category && (
              <span className={ui.kicker}>
                {specLabel(profile.category.specialization)} · {profile.category.grade}
              </span>
            )}
          </div>
        </div>
        <p className={styles.sub}>
          {profile.category
            ? `Категория по тесту: ${specLabel(profile.category.specialization)}, ${profile.category.grade} (${formatDate(profile.category.confirmedAt)})`
            : 'Категории пока нет: её даёт только тест. Ниже - утверждения со ссылками на источники.'}
        </p>
        <p className={styles.printOnly}>Распечатано {formatDate(new Date().toISOString())}</p>
        <dl className={styles.facts}>
          <div>
            <dt>Утверждений</dt>
            <dd>{claims.length}</dd>
          </div>
          <div>
            <dt>Подтверждено</dt>
            <dd>{confirmedCount}</dd>
          </div>
        </dl>
        {test && (
          <div className={styles.testRec} data-testid="test-rec">
            <span className={ui.kicker}>Рекомендация теста</span>
            <b>
              {specLabel(test.specialization)}, {test.grade}
            </b>
            <span className={styles.testReason}>{test.reason}</span>
            {!test.allowed && test.nextAllowedAt && <span className={ui.muted}>Повторно можно с {formatDate(test.nextAllowedAt)}</span>}
          </div>
        )}
        <TestHistory attempts={attempts} />
        <div className={`${styles.sideActions} ${styles.noPrint}`}>
          <Button
            variant="cta"
            href={test ? `/test?specialization=${test.specialization}&grade=${test.grade}` : '/test'}
            data-testid="go-test"
          >
            {profile.category ? 'Пересдать тест' : 'Пройти тест'}
          </Button>
          <Button href="/consultant">К консультанту</Button>
          <Button onClick={() => window.print()}>Печать / PDF</Button>
        </div>
      </aside>

      <div className={styles.main}>
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
                  <ClaimItem key={c.id} claim={c} onDecide={decide} />
                ))}
              </ul>
            </section>
          );
        })
      )}

      <section className={styles.section} aria-labelledby="targets-title">
        <h2 id="targets-title">Подходящие вакансии</h2>
        {recs === null ? (
          <p className={ui.muted} role="status">
            Загружаю…
          </p>
        ) : targets.length > 0 ? (
          <ul className={styles.list}>
            {targets.map((v) => (
              <li key={v.vacancyId} className={`${ui.panel} ${styles.claim}`}>
                <p className={styles.statement}>
                  {v.companyName}, {v.title}
                </p>
                <p className={styles.quote}>{v.reason}</p>
                <div
                  className={ui.meter}
                  role="img"
                  aria-label={`Закрыто ${v.covered} из ${v.total} требований`}
                >
                  {Array.from({ length: v.total }, (_, i) => (
                    <i key={i} className={i < v.covered ? ui.meterOn : undefined} />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className={ui.muted} data-testid="targets-empty">
            {confirmedCount === 0
              ? 'Вакансии подбираются по подтверждённым утверждениям, а пока подтверждённых нет. Подтвердите карточки в чате с консультантом - и здесь появятся вакансии.'
              : 'По подтверждённым утверждениям подходящих вакансий пока нет. Добавьте источники или закройте пробелы из карты ниже.'}
          </p>
        )}
      </section>

      <section className={styles.section} aria-labelledby="gap-title">
        <h2 id="gap-title">Карта пробелов к цели</h2>
        {recs === null ? (
          <p className={ui.muted} role="status">
            Загружаю…
          </p>
        ) : gaps.length === 0 ? (
          <p className={ui.muted}>Карта появится, когда будет выбрана цель: категория или вакансия. Попросите консультанта подобрать цель.</p>
        ) : (
          <GapMap gaps={gaps} pending={pending} />
        )}
        {tasks.length > 0 && (
          <div id="tasks">
            <h3 style={{ fontSize: 'var(--fs-md)', marginBottom: 8 }}>Задания, которые закроют пробелы</h3>
            <ul className={styles.list}>
              {tasks.map((t) => (
                <li key={t.taskId} className={`${ui.panel} ${styles.claim}`}>
                  <p className={styles.statement}>{t.title}</p>
                  <p className={styles.quote}>{t.reason}</p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <fieldset className={`${styles.visibility} ${styles.noPrint}`} disabled>
        <legend>Кто видит профиль</legend>
        <label>
          <input type="radio" name="visibility" defaultChecked /> Только я
        </label>
        <label>
          <input type="radio" name="visibility" /> Работодатели, которые меня приглашают
        </label>
        <p className={ui.muted} style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>
          Настройка видимости пока недоступна: сейчас профиль виден только вам.
        </p>
      </fieldset>
      </div>
    </div>
  );
}
