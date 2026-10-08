import type { EvidenceLevel } from '@/server/claims/types';

export const LEVEL_ORDER: EvidenceLevel[] = ['platform', 'third_party', 'artifact', 'self_reported'];

export const LEVEL_LABEL: Record<EvidenceLevel, string> = {
  self_reported: 'со слов',
  artifact: 'артефакт',
  third_party: 'третья сторона',
  platform: 'платформа',
};

export const LEVEL_HINT: Record<EvidenceLevel, string> = {
  self_reported: 'Так сказано в резюме или в чате; ничем не подтверждено.',
  artifact: 'Есть след работы: репозиторий, статья, публичный профиль.',
  third_party: 'Подтверждено человеком или сервисом со стороны.',
  platform: 'Проверено на платформе: тест или защита.',
};

export function isLevel(v: unknown): v is EvidenceLevel {
  return v === 'self_reported' || v === 'artifact' || v === 'third_party' || v === 'platform';
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Moscow' });
}

export function formatRub(n: number): string {
  return `${n.toLocaleString('ru-RU')} ₽`;
}
