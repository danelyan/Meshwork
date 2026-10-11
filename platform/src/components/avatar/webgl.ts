/**
 * Есть ли WebGL: аватар рисуется в three.js, без WebGL – запасной знак ФСП (SVG).
 * Проверка – по наличию `WebGLRenderingContext` и реальному контексту на пробном canvas
 * (на стенде без GPU контекст может не создаться). Положительный результат кэшируется, отрицательный – нет: контекст мог не создаться из-за лимита
 * вкладок, и при следующем монтировании (или по «обновить») проба повторяется.
 */
let cached: boolean | undefined;

export function detectWebGL(win: (Window & typeof globalThis) | undefined = typeof window === 'undefined' ? undefined : window): boolean {
  if (!win || typeof win.WebGLRenderingContext === 'undefined') return false;
  try {
    const canvas = win.document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export function hasWebGL(): boolean {
  if (cached) return true;
  cached = detectWebGL() || undefined;
  return cached ?? false;
}

/** Только для тестов. */
export function resetWebGLCache(): void {
  cached = undefined;
}
