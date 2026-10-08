import { prisma } from '@/server/db';

import type { AgentEvent } from './types';

/** Элемент ленты в сериализуемом виде (совпадает с FeedItem компонента). */
export type RestoredItem =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'agent'; event: AgentEvent };

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
    for (const m of rows) {
      if (m.role === 'user') items.push({ id: `r-${m.id}`, role: 'user', text: humanizeUserText(m.content, names) });
      else if (m.content.trim()) items.push({ id: `r-${m.id}`, role: 'agent', event: { type: 'message', text: m.content } });
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
