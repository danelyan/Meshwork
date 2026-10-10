'use client';

import { useEffect, useState } from 'react';
import { request } from '@/lib/api';
import { setPrivacyApi } from '@/lib/employer-api';
import type { ProfileDetails } from '@/server/claims/profile-details';
import { Notice } from '../ui';
import styles from './Candidate.module.css';

export function CandidateSidebarSummary() {
  const [profile, setProfile] = useState<ProfileDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let alive = true; request<ProfileDetails>('/api/profile/details').then((p) => alive && setProfile(p), () => undefined); return () => { alive = false; }; }, []);
  if (!profile) return null;
  const value = Math.round(profile.completion.filled / profile.completion.total * 100);
  async function toggle() {
    if (!profile) return;
    setBusy(true); setError(null);
    try { const result = await setPrivacyApi(!profile.hiddenFromEmployers); setProfile({ ...profile, hiddenFromEmployers: result.hiddenFromEmployers }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Не удалось сохранить'); }
    finally { setBusy(false); }
  }
  return <div className={styles.sidebarSummary}>
    <div className={styles.completionLabel}><span>Профиль заполнен</span><b>{value}%</b></div>
    <div className={styles.completionBar} role="progressbar" aria-label="Заполнение профиля" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${value}%` }} /></div>
    <a href="/consultant">{profile.completion.filled < profile.completion.total ? '+ дополнить профиль' : 'Посмотреть ответы'} ↗</a>
    <div className={styles.visibilityRow}><span>Профиль виден компаниям</span><button type="button" className={styles.switch} aria-label="Профиль виден компаниям" aria-pressed={!profile.hiddenFromEmployers} disabled={busy} onClick={() => void toggle()}><i /></button></div>
    <small>{profile.hiddenFromEmployers ? 'Профиль скрыт из поиска' : 'Имя и контакт скрыты до принятия приглашения'}</small>
    {error && <Notice tone="error">{error}</Notice>}
  </div>;
}
