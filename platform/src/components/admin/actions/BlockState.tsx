import { Tag } from '@/components/ui';

/** Состояние блокировки для карточки (даты — ISO-строки). Разблокированный: blockedUntil в прошлом. */
export interface BlockView {
  blockedAt: string | null;
  blockedUntil: string | null;
  blockedReason?: string | null;
}

export function blockedNow(b: BlockView, now = Date.now()): boolean {
  return Boolean(b.blockedAt) && (b.blockedUntil === null || new Date(b.blockedUntil).getTime() > now);
}

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function BlockBadge({ block }: { block: BlockView }) {
  if (!blockedNow(block)) return <Tag tone="outline">активен</Tag>;
  return <Tag tone="dashed">{block.blockedUntil ? `заблокирован до ${fmt(block.blockedUntil)} МСК` : 'заблокирован бессрочно'}</Tag>;
}
