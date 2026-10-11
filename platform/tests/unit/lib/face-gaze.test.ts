import { GAZE_THRESHOLDS, INITIAL_GAZE, LM, type Point, type SettledGaze, lookTargetFrom, readFace, settleGaze } from '@/lib/face-gaze';

/** Синтетическое лицо: центр (cx, cy), полуширина w, полувысота h; смещения носа и зрачков в долях. */
function face(o: { cx?: number; cy?: number; w?: number; h?: number; noseDx?: number; noseDy?: number; irisDx?: number; irisDy?: number; eyeOpen?: number } = {}): Point[] {
  const { cx = 0.5, cy = 0.5, w = 0.15, h = 0.2, noseDx = 0, noseDy = 0.15, irisDx = 0, irisDy = 0, eyeOpen = 0.3 } = o;
  const pts: Point[] = Array.from({ length: 478 }, () => ({ x: cx, y: cy }));
  pts[LM.leftTemple] = { x: cx - w, y: cy };
  pts[LM.rightTemple] = { x: cx + w, y: cy };
  pts[LM.forehead] = { x: cx, y: cy - h };
  pts[LM.chin] = { x: cx, y: cy + h };
  pts[LM.noseTip] = { x: cx + noseDx * w, y: cy + noseDy * h };
  const eye = (ex: number, outer: number, inner: number, top: number, bottom: number, iris: number) => {
    const ew = 0.04;
    pts[outer] = { x: ex - ew, y: cy - 0.05 };
    pts[inner] = { x: ex + ew, y: cy - 0.05 };
    pts[top] = { x: ex, y: cy - 0.05 - (ew * eyeOpen) / 2 };
    pts[bottom] = { x: ex, y: cy - 0.05 + (ew * eyeOpen) / 2 };
    pts[iris] = { x: ex + irisDx * ew, y: cy - 0.05 + ((irisDy * ew * eyeOpen) / 2) };
  };
  eye(cx - 0.07, LM.leftEyeOuter, LM.leftEyeInner, LM.leftEyeTop, LM.leftEyeBottom, LM.leftIris);
  eye(cx + 0.07, LM.rightEyeInner, LM.rightEyeOuter, LM.rightEyeTop, LM.rightEyeBottom, LM.rightIris);
  return pts;
}

describe('лицо и взгляд по точкам Face Landmarker (только показ)', () => {
  it('лицо прямо, зрачки в центре — «на экран»; нет точек — null', () => {
    const r = readFace(face())!;
    expect(r.gaze).toBe('screen');
    expect(Math.abs(r.yaw)).toBeLessThan(0.05);
    expect(Math.abs(r.pitch)).toBeLessThan(0.05);
    expect(readFace(null)).toBeNull();
    expect(readFace(face().slice(0, 100))).toBeNull();
  });

  it('поворот головы или уход зрачков за порог — «в сторону»; закрытые глаза — тоже', () => {
    expect(readFace(face({ noseDx: GAZE_THRESHOLDS.headYaw + 0.2 }))!.gaze).toBe('away');
    expect(readFace(face({ noseDy: 0.15 + GAZE_THRESHOLDS.headPitch + 0.2 }))!.gaze).toBe('away');
    expect(readFace(face({ irisDx: GAZE_THRESHOLDS.iris + 0.3 }))!.gaze).toBe('away');
    expect(readFace(face({ eyeOpen: 0.02 }))!.gaze).toBe('away');
    expect(readFace(face({ noseDx: 0.1, irisDx: 0.05 }))!.gaze).toBe('screen');
  });

  it('цель для головы: лицо слева в зеркальном превью → голова смотрит влево (X < 0), выше центра → вверх', () => {
    // Человек сдвинулся влево от себя: в кадре камеры лицо правее центра, в зеркале — левее.
    const r = readFace(face({ cx: 0.7, cy: 0.3 }))!;
    const [x, y] = lookTargetFrom(r, true);
    expect(x).toBeLessThan(-0.3);
    expect(y).toBeGreaterThan(0.3);
    expect(lookTargetFrom(r, false)[0]).toBeGreaterThan(0.3);
  });

  it('сглаживание: «в сторону» показывается после 700 мс непрерывно, моргание и потеря лица на кадр — нет; возврат — сразу', () => {
    let s: SettledGaze = { state: 'screen', pending: null, pendingSince: 0 };
    s = settleGaze(s, 'away', 100);
    expect(s.state).toBe('screen');
    s = settleGaze(s, 'away', 800);
    expect(s.state).toBe('away');
    s = settleGaze(s, 'screen', 850);
    expect(s.state).toBe('screen');
    expect(settleGaze(s, 'screen', 900)).toBe(s);
    // Моргнул (away на один кадр), вернулся, снова away: отсчёт начинается заново.
    s = settleGaze(s, 'away', 1000);
    s = settleGaze(s, 'screen', 1100);
    s = settleGaze(s, 'away', 1200);
    expect(settleGaze(s, 'away', 1850).state).toBe('screen');
    expect(settleGaze(s, 'away', 1900).state).toBe('away');
    // Чередование away/none не копит время друг друга.
    s = settleGaze({ state: 'screen', pending: null, pendingSince: 0 }, 'none', 0);
    s = settleGaze(s, 'away', 400);
    expect(settleGaze(s, 'away', 900).state).toBe('screen');
    expect(settleGaze(s, 'away', 1100).state).toBe('away');
    expect(settleGaze(INITIAL_GAZE, 'none', 5).state).toBe('none');
  });
});
