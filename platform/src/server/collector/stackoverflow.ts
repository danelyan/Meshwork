import { AppError } from '../errors';
import { buildDoc, type RawLine } from './doc';
import { getJson } from './http-json';
import type { ExtractedDoc } from './types';

/** Stack Overflow (Stack Exchange API 2.3, без ключа 300 запросов/сутки): репутация и топ-теги. */
export const SE_API = 'https://api.stackexchange.com/2.3';

interface SeUser {
  user_id: number;
  display_name: string;
  reputation: number;
  badge_counts: { gold: number; silver: number; bronze: number };
  link: string;
}
interface SeTag {
  tag_name: string;
  answer_count: number;
  answer_score: number;
  question_count: number;
}

export async function fetchStackOverflow(handle: string): Promise<ExtractedDoc> {
  const id = /^\d{1,10}$/.exec(handle)?.[0];
  if (!id) throw new AppError('bad_request', 'Нужен числовой id пользователя Stack Overflow', 400);
  const src = 'Stack Overflow';
  const users = (await getJson<{ items: SeUser[] }>(`${SE_API}/users/${id}?site=stackoverflow`, { source: src })).json.items;
  const user = users?.[0];
  if (!user) throw new AppError('not_found', 'Пользователь Stack Overflow не найден', 404);
  const tags =
    (await getJson<{ items: SeTag[] }>(`${SE_API}/users/${id}/top-tags?site=stackoverflow&pagesize=10`, { source: src })).json
      .items ?? [];
  const p = `stackoverflow:${id}`;
  const b = user.badge_counts;
  const lines: RawLine[] = [
    { ref: `${p}#info:l1`, text: `Stack Overflow: ${user.display_name}, репутация ${user.reputation}` },
    { ref: `${p}#info:l2`, text: `Значки: золото ${b.gold}, серебро ${b.silver}, бронза ${b.bronze}` },
    ...tags.map((t, i) => ({
      ref: `${p}#tags:l${i + 1}`,
      text: `Тег ${t.tag_name}: ответов ${t.answer_count} (рейтинг ${t.answer_score}), вопросов ${t.question_count}`,
    })),
  ];
  return buildDoc({
    sourceKind: 'stackoverflow',
    title: `Stack Overflow ${user.display_name}`,
    origin: p,
    lines,
    meta: { url: user.link, reputation: user.reputation, ownershipVerified: false },
  });
}
