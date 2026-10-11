/**
 * Внешняя цель взгляда головы: положение лица собеседника с камеры (комната звонка). Пока цель свежая,
 * Head3D смотрит на неё вместо курсора; устарела (камера выключена, лица нет) – снова курсор.
 */
let target: { x: number; y: number; at: number } | null = null;
export const LOOK_TARGET_TTL_MS = 1500;

export function setLookTarget(x: number, y: number, now = Date.now()): void {
  target = { x, y, at: now };
}

export function clearLookTarget(): void {
  target = null;
}

export function getLookTarget(now = Date.now()): [number, number] | null {
  if (!target || now - target.at > LOOK_TARGET_TTL_MS) return null;
  return [target.x, target.y];
}
