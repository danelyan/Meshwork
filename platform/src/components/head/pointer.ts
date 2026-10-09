/** The whole page is the gaze target, including the chat column. */
export function headPointer(x: number, y: number, width: number, height: number, centerX = width / 2, centerY = height / 2): [number, number] {
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return [clamp((x - centerX) / Math.max(1, width) * 2), clamp((centerY - y) / Math.max(1, height) * 2)];
}
