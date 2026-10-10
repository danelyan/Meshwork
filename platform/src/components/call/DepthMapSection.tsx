'use client';

import { useEffect, useState } from 'react';

import { callApi } from '@/lib/call-api';
import type { CallVerdict, CallView } from '@/server/call/types';

import { Button } from '../ui';

import styles from './DepthMap.module.css';
import { DepthMap } from './DepthMap';

const fmt = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Moscow' });

/**
 * Карта глубины последнего квалифицирующего созвона в профиле кандидата (ADR 0003, ступень 1).
 * Созвона не было — короткое приглашение созвониться из чата. Запись своих ответов доступна всегда.
 */
export function DepthMapSection() {
  const [call, setCall] = useState<CallView | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    callApi
      .list('qualifying')
      .then((r) => alive && setCall(r.calls.find((c) => c.status === 'finished' && c.verdict) ?? null))
      .catch(() => alive && setCall(null));
    return () => {
      alive = false;
    };
  }, []);
  if (call === undefined) return null;
  return (
    <section className={styles.section} aria-labelledby="depth-title" data-testid="depth-map-section">
      <h2 id="depth-title">Карта глубины</h2>
      {call?.verdict ? (
        <>
          <p className={styles.note}>
            Квалифицирующий созвон {call.finishedAt ? fmt.format(new Date(call.finishedAt)) : ''} МСК. Оценка - медиана трёх прогонов отдельного оценщика по рубрике.
          </p>
          <DepthMap verdict={call.verdict as CallVerdict} />
          {call.hasRecording && (
            <audio className={styles.audio} controls preload="none" src={callApi.recordingUrl(call.id)}>
              Запись ответов
            </audio>
          )}
          <div>
            <Button href="/consultant" size="sm">
              Созвониться ещё раз
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.note}>
            Созвона ещё не было. В чате консультанта нажми «Созвониться»: ИИ задаст 4–6 вопросов голосом по твоей специализации, отдельный оценщик построит карту глубины, а подтверждённые темы получат уровень «проверено платформой». Категорию созвон не меняет.
          </p>
          <div>
            <Button href="/consultant" size="sm">
              Созвониться
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
