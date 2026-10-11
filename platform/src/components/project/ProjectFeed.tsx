'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ApiError } from '@/lib/api';
import { takeProjectApi } from '@/lib/project-api';
import type { FeedItem } from '@/server/project/service';

import styles from './Project.module.css';
import { Button, Notice, Panel, Tag } from '../ui';

import { GRADE_RU, SUBMISSION_STATUS, hours } from './labels';

export interface ProjectFeedProps {
  items: FeedItem[];
  limit: { maxActive: number; active: number };
  /** Категория из теста уже есть: пустая лента не зовёт проходить тест повторно. */
  hasCategory?: boolean;
}

/** Лента обезличенных проектных заданий (ADR 0003, п. 6): без компании и зарплаты; «Взять» - с лимитом активных. */
export function ProjectFeed({ items, limit, hasCategory = false }: ProjectFeedProps) {
  const router = useRouter();
  const [filter, setFilter] = useState<'all' | 'mine' | 'available'>('all');
  const visible = items.filter((item) => filter === 'all' || (filter === 'mine' ? item.my.taken : !item.my.taken));
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
      <header className={styles.heading}>
        <h1>Проекты<i>.</i></h1>
        <p className={styles.lead}>
          Задачи от работодателей твоего направления - без названия компании и зарплаты: это не вакансия, а проект, по которому
          тебя могут позвать на защиту. ИИ-ассистенты разрешены. Взятых несданных - не больше {limit.maxActive} (сейчас {limit.active}).
        </p>
      </header>
      <div className={styles.feedTabs} aria-label="Фильтр заданий">{([{ id: 'all', label: 'Для вас' }, { id: 'mine', label: 'Мои' }, { id: 'available', label: 'Доступно' }] as const).map((tab) => <Button size="sm" key={tab.id} aria-pressed={filter === tab.id} onClick={() => setFilter(tab.id)}>{tab.label} · {items.filter((item) => tab.id === 'all' || (tab.id === 'mine' ? item.my.taken : !item.my.taken)).length}</Button>)}</div>
      {error && <Notice tone="error">{error}</Notice>}
      {visible.length === 0 ? (
        items.length ? (
          <Notice>В этой группе пока нет заданий. Выберите другую вкладку.</Notice>
        ) : hasCategory ? (
          <>
            <Notice>Сейчас нет открытых заданий для твоей категории. Они появляются, когда работодатели твоего направления публикуют проект. Загляни позже.</Notice>
            <div className={styles.actions}>
              <Button href="/consultant" variant="primary">
                Следующий шаг – у консультанта
              </Button>
            </div>
          </>
        ) : (
          <>
            <Notice>Пока нет открытых заданий для твоего направления. Без категории из теста видны только задания уровня Junior – пройди тест на грейд, чтобы открыть остальные.</Notice>
            <div className={styles.actions}>
              <Button href="/test" variant="cta">
                Пройти тест на грейд
              </Button>
            </div>
          </>
        )
      ) : (
        <ul className={styles.list} aria-label="Задания">
          {visible.map((t) => (
            <Panel as="li" key={t.id} className={styles.card}>
              <div className={styles.cardHead}>
                <h2>{t.title}</h2>
                <Tag tone={t.my.taken ? 'solid' : 'outline'}>{t.my.last?.status === 'checked' ? 'Проверено' : t.my.taken ? 'В работе' : t.invited ? 'По приглашению' : 'Доступно'}</Tag>
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
              <footer className={styles.actions}>
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
              </footer>
            </Panel>
          ))}
        </ul>
      )}
    </div>
  );
}
