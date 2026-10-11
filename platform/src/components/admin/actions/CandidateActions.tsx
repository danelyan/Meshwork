'use client';

import { useEffect, useState } from 'react';

import { Tag } from '@/components/ui';

import styles from '@/app/(admin)/admin/admin.module.css';

import { adminFetch } from '../adminFetch';

import { ReasonAction } from './ReasonAction';

interface CooldownState {
  category: { specialization: string; grade: string; confirmedAt: string } | null;
  lastAttempt: { grade: string; status: string; finishedAt: string } | null;
  resetAt: string | null;
}

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export interface CandidateActionsProps {
  candidateId: string;
  /** Скрыт ли профиль модератором (последнее решение hide_candidate). */
  hiddenByModerator: boolean;
  /** Права: hide_candidate, reset_cooldown. */
  can: { hide: boolean; resetCooldown: boolean };
}

/**
 * Действия в карточке кандидата (E-08 фаза 3): скрыть/вернуть в поиске, сбросить кулдаун теста (R-C-09).
 * Категорию и грейд админ не меняет (R-C-06) — такой кнопки нет намеренно.
 */
export function CandidateActions({ candidateId, hiddenByModerator: initialHidden, can }: CandidateActionsProps) {
  const [hidden, setHidden] = useState(initialHidden);
  const [cooldown, setCooldown] = useState<CooldownState | null>(null);
  useEffect(() => {
    if (!can.resetCooldown) return;
    adminFetch<CooldownState>(`/api/admin/candidates/${candidateId}/cooldown`).then(setCooldown).catch(() => setCooldown(null));
  }, [candidateId, can.resetCooldown]);

  return (
    <div className={styles.form}>
      {can.hide && (
        <div className={styles.row}>
          {hidden ? <Tag tone="dashed">скрыт модератором</Tag> : null}
          {hidden ? (
            <ReasonAction label="Вернуть в поиск" url={`/api/admin/candidates/${candidateId}/hide`} method="POST" body={{ hidden: false }} description="Видимость вернётся к выбору самого кандидата: без его согласия на показ работодателям профиль останется скрыт." onDone={() => setHidden(false)} />
          ) : (
            <ReasonAction label="Скрыть из поиска" danger url={`/api/admin/candidates/${candidateId}/hide`} method="POST" body={{ hidden: true }} description="Профиль пропадёт из подборки и поиска работодателей. Сам кандидат вернуть его не сможет." onDone={() => setHidden(true)} />
          )}
        </div>
      )}
      {can.resetCooldown && (
        <div className={styles.form}>
          {cooldown && (
            <p className={styles.muted}>
              Категория: {cooldown.category ? `${cooldown.category.specialization} · ${cooldown.category.grade} (с ${fmt(cooldown.category.confirmedAt)})` : 'нет'}. Последняя попытка: {cooldown.lastAttempt ? `${cooldown.lastAttempt.grade}, ${cooldown.lastAttempt.status}, ${fmt(cooldown.lastAttempt.finishedAt)}` : 'нет'}.
              {cooldown.resetAt ? ` Кулдаун сброшен ${fmt(cooldown.resetAt)}.` : ''}
            </p>
          )}
          <div className={styles.row}>
            <ReasonAction
              label="Сбросить кулдаун теста"
              url={`/api/admin/candidates/${candidateId}/cooldown`}
              method="POST"
              description="Смена грейда и пересдача станут доступны сразу. Категория не меняется; следующая попытка снова запустит интервалы."
              onDone={(r) => setCooldown((c) => (c ? { ...c, resetAt: (r as { resetAt: string }).resetAt } : c))}
            />
          </div>
        </div>
      )}
    </div>
  );
}
