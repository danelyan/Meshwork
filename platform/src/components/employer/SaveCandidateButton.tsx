'use client';

import { useEffect, useState } from 'react';
import { getFavorites, setFavorite } from '@/lib/favorites';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui';
import styles from './Employer.module.css';

export function SaveCandidateButton({ scope, candidateId, initialSaved, onChange }: { scope: string; candidateId: string; initialSaved?: boolean; onChange?: (saved: boolean) => void }) {
  const [saved, setSaved] = useState(initialSaved ?? false);
  const [busy, setBusy] = useState(initialSaved === undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (initialSaved !== undefined) return;
    let active = true;
    setBusy(true);
    void getFavorites().then((result) => { if (active) setSaved(result.ids.includes(candidateId)); }).catch(() => { if (active) setError('Не удалось загрузить избранное'); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [scope, candidateId, initialSaved]);
  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const result = await setFavorite('candidate', candidateId, !saved);
      const next = result.ids.includes(candidateId);
      setSaved(next);
      onChange?.(next);
    } catch (err) { setError(err instanceof ApiError ? err.message : 'Не удалось сохранить избранное'); }
    finally { setBusy(false); }
  }
  return <><Button size="sm" className={styles.saveButton} aria-pressed={saved} loading={busy} onClick={toggle}>{saved ? '★ В избранном' : '☆ В избранное'}</Button>{error && <span role="alert">{error}</span>}</>;
}
