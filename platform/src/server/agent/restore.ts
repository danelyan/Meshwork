import { prisma } from '@/server/db';

import { ASIDE_MARK_RE, PAUSE_MARK_RE } from '@/server/onboarding/match';

import type { AgentEvent } from './types';

/**
 * Элемент ленты в сериализуемом виде (совпадает с FeedItem компонента). `stepId` — реплика
 * свободного вопроса посреди шага онбординга (маркер в тексте хода) и ответ на неё: лента
 * онбординга показывает их под своим шагом, встроенный консультант — без них (без дублей).
 * `paused` — реплика свободного разговора, пока знакомство было на паузе («Настроить позже»):
 * `stepId` — шаг паузы; лента показывает её под ним, лента паузы — в чате.
 */
export type RestoredItem =
  | { id: string; role: 'user'; text: string; stepId?: string; paused?: true }
  | { id: string; role: 'agent'; event: AgentEvent; stepId?: string; paused?: true };

/** Шаг паузы из маркера в тексте хода; null — не на паузе. */
export function pauseStepOf(content: string): string | null {
  for (const line of content.split('\n')) {
    const m = PAUSE_MARK_RE.exec(line.trim());
    if (m) return m[1]!;
  }
  return null;
}

/** Шаг онбординга из маркера в тексте хода кандидата; null — обычная реплика. */
export function asideStepOf(content: string): string | null {
  for (const line of content.split('\n')) {
    const m = ASIDE_MARK_RE.exec(line.trim());
    if (m) return m[1]!;
  }
  return null;
}

const ATTACH_RE = /^\[вложения: (.+)\]$/;
const LINKS_RE = /^\[ссылки: (.+)\]$/;

/**
 * Служебные строки хода («[вложения: файл <id>]», «[ссылки: …]») нужны модели
 * (id — для read_upload), но не кандидату: при показе id заменяются именами файлов,
 * скобки уходят. names — имена по id; неизвестный id показывается как «файл».
 */
export function humanizeUserText(content: string, names: Map<string, string>): string {
  return content
    .split('\n')
    .map((line) => {
      const a = ATTACH_RE.exec(line);
      if (a) {
        const files = a[1]!.split(', ').map((p) => names.get(p.replace(/^файл /, '').trim()) ?? 'файл');
        return `Вложения: ${files.join(', ')}`;
      }
      const l = LINKS_RE.exec(line);
      if (l) return `Ссылки: ${l[1]}`;
      return line;
    })
    .filter((line) => !ASIDE_MARK_RE.test(line.trim()) && !PAUSE_MARK_RE.test(line.trim()))
    .join('\n');
}

export interface RestoredChat {
  conversationId: string | null;
  items: RestoredItem[];
}

/**
 * Последний разговор кандидата для перезагрузки страницы: реплики (user и
 * непустые assistant) и карточки утверждений, которые ещё ждут ответа, с
 * актуальными статусами из БД. Чужие разговоры не читаются: выборка по candidateId.
 */
export async function loadLastChat(candidateId: string): Promise<RestoredChat> {
  const conv = await prisma.conversation.findFirst({ where: { candidateId }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  const items: RestoredItem[] = [];
  if (conv) {
    const rows = await prisma.message.findMany({
      where: { conversationId: conv.id, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true },
    });
    const ids = new Set<string>();
    for (const m of rows) {
      if (m.role !== 'user') continue;
      for (const line of m.content.split('\n')) {
        const a = ATTACH_RE.exec(line);
        if (a) for (const p of a[1]!.split(', ')) ids.add(p.replace(/^файл /, '').trim());
      }
    }
    const uploads = ids.size ? await prisma.upload.findMany({ where: { id: { in: [...ids] }, candidateId }, select: { id: true, filename: true } }) : [];
    const names = new Map(uploads.map((u) => [u.id, u.filename]));
    let tag: { stepId?: string; paused?: true } = {};
    for (const m of rows) {
      if (m.role === 'user') {
        const aside = asideStepOf(m.content);
        const pause = aside ? null : pauseStepOf(m.content);
        tag = aside ? { stepId: aside } : pause ? { stepId: pause, paused: true } : {};
        items.push({ id: `r-${m.id}`, role: 'user', text: humanizeUserText(m.content, names), ...tag });
      } else if (m.content.trim()) {
        items.push({ id: `r-${m.id}`, role: 'agent', event: { type: 'message', text: m.content }, ...tag });
      }
    }
  }
  const pending = await prisma.claim.findMany({ where: { candidateId, status: 'proposed' }, orderBy: { createdAt: 'asc' } });
  if (pending.length) {
    items.push({
      id: 'r-pending-claims',
      role: 'agent',
      event: {
        type: 'claims',
        rejected: 0,
        proposed: pending.map((c) => ({
          id: c.id,
          catalogId: c.catalogId,
          statement: c.statement,
          level: c.level,
          quote: c.quote,
          sourceRef: c.sourceRef,
          limits: c.limits,
          status: c.status,
        })),
      },
    });
  }
  return { conversationId: conv?.id ?? null, items };
}
