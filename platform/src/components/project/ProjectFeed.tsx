'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiError } from '@/lib/api';
import { takeProjectApi } from '@/lib/project-api';
import type { FeedItem } from '@/server/project/service';

import styles from '../employer/Employer.module.css';
import { Button, Notice, Panel, Tag } from '../ui';

import { GRADE_RU, SUBMISSION_STATUS, hours } from './labels';

export interface ProjectFeedProps {
  items: FeedItem[];
  limit: { maxActive: number; active: number };
}

/** Лента обезличенных проектных заданий (ADR 0003, п. 6): без компании и зарплаты; «Взять» — с лимитом активных. */
export function ProjectFeed({ items, limit }: ProjectFeedProps) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function take(id: string) {
    setBusy(id);
    setError(null);
    try {
      await takeProjectApi(id);
      router.push(`/projects/${encodeURIComponent(id)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось взять задание');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={styles.page}>
      <div>
        <h1>Проектные задания</h1>
        <p className={styles.lead}>
          Задачи от работодателей твоего направления — без названия компании и зарплаты: это не вакансия, а проект, по которому
          тебя могут позвать на защиту. ИИ-ассистенты разрешены. Взятых несданных — не больше {limit.maxActive} (сейчас {limit.active}).
        </p>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {items.length === 0 ? (
        <Notice>Пока нет открытых заданий для твоего направления и грейда. Загляни позже или пройди тест — категория уточнит подборку.</Notice>
      ) : (
        <ul className={styles.list} aria-label="Задания">
          {items.map((t) => (
            <Panel as="li" key={t.id} className={styles.card}>
              <div className={styles.cardHead}>
                <h2>{t.title}</h2>
                {t.invited && <Tag tone="solid">по приглашению</Tag>}
              </div>
              <div className={styles.meta}>
                <Tag tone="outline">{t.specializationLabel}</Tag>
                {t.subcategoryTitle && <Tag tone="outline">{t.subcategoryTitle}</Tag>}
                <Tag tone="outline">{GRADE_RU[t.grade] ?? t.grade}</Tag>
                <span>{hours(t.timeBudgetMin)}</span>
                <span>срок {t.deadlineDays} дн.</span>
                <span>{t.stack.join(', ')}</span>
              </div>
              <p className={styles.text}>{t.domainStory}</p>
              <div className={styles.actions}>
                {t.my.taken ? (
                  <Button href={`/projects/${encodeURIComponent(t.id)}`} variant="primary" size="sm">
                    {t.my.last ? `Открыть (${SUBMISSION_STATUS[t.my.last.status]})` : 'Открыть'}
                  </Button>
                ) : (
                  <>
                    <Button variant="cta" size="sm" loading={busy === t.id} onClick={() => take(t.id)} aria-label={`Взять: ${t.title}`}>
                      Взять
                    </Button>
                    <Button href={`/projects/${encodeURIComponent(t.id)}`} size="sm">
                      Подробнее
                    </Button>
                  </>
                )}
              </div>
            </Panel>
          ))}
        </ul>
      )}
    </div>
  );
}
