export type SheetMotion = { yaw: number; pitch: number; breath: number; blink: number };

/** Low-amplitude sheet movement; reduced-motion freezes all deformation. */
export function sheetMotion(milliseconds: number, reducedMotion: boolean): SheetMotion {
  if (reducedMotion) return { yaw: 0, pitch: 0, breath: 0, blink: 0 };
  const seconds = milliseconds / 1000;
  const cycle = ((seconds % 5.8) + 5.8) % 5.8;
  const blink = Math.max(0, 1 - Math.abs(cycle - 4.7) / .12);
  return {
    yaw: Math.sin(seconds * .43) * .055,
    pitch: Math.sin(seconds * .61 + .7) * .028,
    breath: Math.sin(seconds * 1.15) * .007,
    blink: blink * blink * (3 - 2 * blink),
  };
}
