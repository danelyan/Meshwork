'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiError, getProfile, getRecommendations, type RecommendationsView } from '@/lib/api';
import { formatDate, LEVEL_HINT, LEVEL_ORDER } from '@/lib/labels';
import type { ProfileClaim, ProfileView } from '@/server/claims/types';
import type { Gap } from '@/server/recommend/types';

import { LevelBadge } from './LevelBadge';
import styles from './ProfilePage.module.css';
import ui from './ui.module.css';

const STATUS_NOTE = { proposed: 'ждёт вашего подтверждения', edited: 'исправлено вами' } as const;

function ClaimItem({ claim }: { claim: ProfileClaim }) {
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
          <span>Не доказывает: {claim.limits}</span>
        </div>
      )}
      {provable && (
        <div className={`${styles.actions} ${styles.noPrint}`}>
          <Link className={styles.link} href={`/defense/${encodeURIComponent(claim.id)}`}>
            Доказать защитой
          </Link>
        </div>
      )}
    </li>
  );
}

function GapMap({ gaps }: { gaps: Gap[] }) {
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
              <td>{g.currentLevel ? <LevelBadge level={g.currentLevel} /> : <span className={ui.muted}>нет утверждения</span>}</td>
              <td>{g.suggestedProof.length ? g.suggestedProof.join('; ') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProfilePage() {
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [recs, setRecs] = useState<RecommendationsView | null>(null);
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
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    const unauth = error instanceof ApiError && error.status === 401;
    return (
      <div className={styles.page}>
        <p className={`${ui.notice} ${ui.errorBox}`} role="alert">
          {error.message}
        </p>
        {unauth && (
          <Link className={styles.link} href="/" style={{ justifySelf: 'start' }}>
            На страницу входа
          </Link>
        )}
      </div>
    );
  }
  if (!profile) {
    return (
      <div className={styles.page} aria-busy="true">
        <p className={ui.muted} role="status">
          <span className={ui.spinner} aria-hidden="true" /> Загружаю профиль…
        </p>
      </div>
    );
  }

  const claims = profile.claims.filter((c) => c.status !== 'rejected');
  const gaps = recs?.gaps ?? [];
  const tasks = recs?.tasks ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.top}>
        <div>
          <h1>{profile.candidate.name}</h1>
          <p className={styles.sub}>
            {profile.category
              ? `Категория по тесту: ${profile.category.specialization === 'backend' ? 'Backend' : 'Frontend'}, ${profile.category.grade} (${formatDate(profile.category.confirmedAt)})`
              : 'Категории пока нет: её даёт только тест. Ниже — утверждения со ссылками на источники.'}
          </p>
          <p className={styles.printOnly}>Распечатано {formatDate(new Date().toISOString())}</p>
        </div>
        <div className={`${styles.actions} ${styles.noPrint}`}>
          <button type="button" className={`${ui.btn} ${ui.small}`} onClick={() => window.print()}>
            Печать / PDF
          </button>
          <Link className={styles.link} href="/consultant">
            К консультанту
          </Link>
        </div>
      </div>

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
        LEVEL_ORDER.map((level) => {
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
                  <ClaimItem key={c.id} claim={c} />
                ))}
              </ul>
            </section>
          );
        })
      )}

      <section className={styles.section} aria-labelledby="gap-title">
        <h2 id="gap-title">Карта пробелов к цели</h2>
        {recs === null ? (
          <p className={ui.muted} role="status">
            Загружаю…
          </p>
        ) : gaps.length === 0 ? (
          <p className={ui.muted}>Карта появится, когда будет выбрана цель: категория или вакансия. Попросите консультанта подобрать цель.</p>
        ) : (
          <GapMap gaps={gaps} />
        )}
        {tasks.length > 0 && (
          <div>
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
  );
}
