'use client';

import { useEffect, useRef, useState } from 'react';

import { readError } from '@/lib/api';
import { formatPoints, type Comparison } from '@/server/employer/compare';

import { Button, Notice } from '../ui';

import styles from './Employer.module.css';

/** «Почему A выше B»: таблица «фактор / A / B / разница» по формуле ранжирования подборки. */
export function CompareDialog({ vacancyId, a, b, onClose }: {
  vacancyId: string;
  a: { id: string; name: string };
  b: { id: string; name: string };
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<Comparison | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus(); };
  }, []);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/employer/vacancies/${encodeURIComponent(vacancyId)}/compare?a=${encodeURIComponent(a.id)}&b=${encodeURIComponent(b.id)}`);
        if (!res.ok) throw await readError(res);
        const body = (await res.json()) as Comparison;
        if (alive) setData(body);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Не удалось сравнить');
      }
    })();
    return () => { alive = false; };
  }, [vacancyId, a.id, b.id]);

  return <dialog ref={ref} className={`${styles.invitationDialog} ${styles.compareDialog}`} aria-label="Сравнение кандидатов" onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={styles.dialogHeading}><span className={styles.status}>Почему A выше B</span><Button size="sm" onClick={onClose} aria-label="Закрыть сравнение">×</Button></div>
    <h2>{a.name} и {b.name}</h2>
    {error && <Notice role="alert">{error}</Notice>}
    {!data && !error && <p className={styles.meta} role="status">Считаем разницу…</p>}
    {data && <>
      <p className={styles.compareHeadline} data-testid="compare-headline">{data.headline}</p>
      <table className={styles.compareTable}>
        <caption>Вклад факторов в итоговый балл, п.</caption>
        <thead><tr><th scope="col">Фактор</th><th scope="col">A · {a.name}</th><th scope="col">B · {b.name}</th><th scope="col">Разница</th></tr></thead>
        <tbody>
          {data.factors.map((f) => <tr key={f.key} data-lead={data.advantage.includes(f.key)}>
            <th scope="row">{f.label}</th><td>{formatPoints(f.a)}</td><td>{formatPoints(f.b)}</td><td>{formatPoints(f.diff)}</td>
          </tr>)}
        </tbody>
        <tfoot><tr><th scope="row">Итоговый балл</th><td>{data.aScore.toFixed(1).replace('.', ',')}</td><td>{data.bScore.toFixed(1).replace('.', ',')}</td><td>{formatPoints(data.diff)}</td></tr></tfoot>
      </table>
      <p className={styles.meta}>Баллы - те же вклады, что в порядке подборки; новых весов нет.</p>
    </>}
  </dialog>;
}
