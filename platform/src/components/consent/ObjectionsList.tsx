'use client';

import { useEffect, useState } from 'react';

import { listObjectionsApi } from '@/lib/consent-api';
import { formatDate } from '@/lib/labels';
import type { ObjectionView } from '@/server/consent/objections';
import { OBJECTION_ANSWER_DAYS } from '@/server/consent/texts';

import { Panel } from '../ui';

const SUBJECT: Record<ObjectionView['subject'], string> = { grade_test: 'Категория (тест)', call: 'Оценка созвона', defense: 'Оценка защиты' };

/** Мои возражения против оценки (ст. 16, ADR 0005): статус, срок ответа (30 дней), ответ. Работодатель их не видит. */
export function ObjectionsList() {
  const [items, setItems] = useState<ObjectionView[] | null>(null);
  useEffect(() => {
    let alive = true;
    listObjectionsApi().then((r) => alive && setItems(Array.isArray(r?.objections) ? r.objections : [])).catch(() => alive && setItems([]));
    return () => { alive = false; };
  }, []);
  return (
    <Panel aria-labelledby="objections-title" data-testid="objections-list">
      <h2 id="objections-title">Возражения против оценки</h2>
      <p><small>Оспорить категорию, оценку созвона или защиты можно кнопкой «Оспорить оценку» рядом с результатом. Ответ - в течение {OBJECTION_ANSWER_DAYS} дней; работодатель возражения не видит.</small></p>
      {items === null ? <p>Загружаем…</p> : items.length === 0 ? <p>Возражений нет.</p> : (
        <ul>
          {items.map((o) => (
            <li key={o.id}>
              <b>{SUBJECT[o.subject]}</b> · {formatDate(o.createdAt)} · {o.status === 'open' ? `ждёт ответа до ${formatDate(o.dueAt)}` : `ответ ${o.answeredAt ? formatDate(o.answeredAt) : ''}`}
              <p>{o.text}</p>
              {o.answer && <p><i>Ответ:</i> {o.answer}</p>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
