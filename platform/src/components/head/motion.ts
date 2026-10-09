export type HeadMotion = { yaw: number; pitch: number; blink: number; breath: number };

/** The source mesh faces 31 degrees right; compensate before tracking. */
export function headPose(pointerX: number, pointerY: number): [number, number] {
  const clamp = (value: number) => Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  return [-.54 + clamp(pointerX) * .24, .03 - clamp(pointerY) * .07];
}

/** Keep the ears clear of the canvas at wide yaw and narrow desktop columns. */
export function portraitZoom(aspect: number): number {
  return Math.min(1, Math.max(.1, aspect) / .9);
}

/** Animation time advances only while the renderer is visible and playing. */
export function headMotion(seconds: number): HeadMotion {
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  // Two short lid closures per irregular-looking nine second cycle.
  const phase = t % 9;
  const pulse = (center: number) => Math.max(0, 1 - Math.abs(phase - center) / .12);
  const blink = Math.max(pulse(3.2), pulse(7.7));
  return {
    yaw: Math.sin(t * .43) * .024,
    pitch: Math.sin(t * .67) * .017,
    blink: blink * blink * (3 - 2 * blink),
    breath: Math.sin(t * 1.35) * .0035,
  };
}

/** Public audio envelopes cannot pass NaN or extreme morph weights to WebGL. */
export function mouthWeights(mouth: number, round = 0, wide = 0): [number, number, number] {
  const bounded = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  return [bounded(mouth), bounded(round), bounded(wide)];
}

/** Matches the shader skinning mask: shoulders remain fixed while the head turns. */
export function neckWeight(y: number): number {
  const t = Math.max(0, Math.min(1, (y - .06) / .24));
  return t * t * (3 - 2 * t);
}
