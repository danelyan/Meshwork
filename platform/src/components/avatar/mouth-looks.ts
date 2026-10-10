/**
 * Вид открытого рта у головы с ригом (head-mouth.glb): что видно между губами. Во всех вариантах,
 * кроме прежнего, внутри рта нет бликов окружения и металла, а полость темнеет к задней стенке —
 * рот читается как пространство, а не как светлое пятно. Код варианта — uniform `uMouthLook` в Head3D,
 * порядок — как в `MOUTH_LOOKS`.
 */
export type MouthLook = 'cavity' | 'threads' | 'teeth' | 'glow' | 'legacy';

export interface MouthLookInfo {
  id: MouthLook;
  label: string;
  hint: string;
}

export const MOUTH_LOOKS: readonly MouthLookInfo[] = [
  { id: 'cavity', label: 'Полость', hint: 'Зубов и языка нет: тёмная полость, темнее к задней стенке' },
  { id: 'threads', label: 'Полость + нити', hint: 'Нити сетки уходят внутрь рта и гаснут в глубине' },
  { id: 'teeth', label: 'Приглушённые зубы', hint: 'Зубы и язык на месте, но матовые и в тени' },
  { id: 'glow', label: 'Свечение', hint: 'В глубине рта слабое свечение фирменным синим' },
  { id: 'legacy', label: 'Как было', hint: 'Прежний вид: светлые металлические зубы — для сравнения' },
] as const;

export const DEFAULT_MOUTH_LOOK: MouthLook = 'cavity';

/** Числовой код вида рта для шейдера (`uMouthLook`). */
export function mouthLookIndex(look: MouthLook): number {
  return MOUTH_LOOKS.findIndex((l) => l.id === look);
}

export function isMouthLook(value: unknown): value is MouthLook {
  return typeof value === 'string' && MOUTH_LOOKS.some((l) => l.id === value);
}
