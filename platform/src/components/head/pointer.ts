/** The whole page is the gaze target, including the chat column. */
export function headPointer(x: number, y: number, width: number, height: number): [number, number] {
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  return [clamp(x / Math.max(1, width) * 2 - 1), clamp(1 - y / Math.max(1, height) * 2)];
}
