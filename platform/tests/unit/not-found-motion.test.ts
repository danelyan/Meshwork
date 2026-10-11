import { describe, expect, it } from 'vitest';

import { pointerPose, trackPose } from '@/components/avatar/head-motion';

describe('404 pointer response', () => {
  it('turns away on both axes, rather than tracking the cursor', () => {
    const neutral = trackPose(0, 0);
    for (const x of [-1, 1]) {
      expect(Math.sign(pointerPose(x, 0, 'avoid')[0])).toBe(-x);
      expect(Math.abs(pointerPose(x, 0, 'avoid')[0])).toBeGreaterThan(Math.abs(trackPose(x, 0)[0]));
    }
    expect(pointerPose(0, 1, 'avoid')[1]).toBeGreaterThan(neutral[1]);
    expect(pointerPose(0, -1, 'avoid')[1]).toBeLessThan(neutral[1]);
  });

  it('returns to neutral and limits off-screen or invalid coordinates', () => {
    expect(pointerPose(0, 0, 'avoid')).toEqual(trackPose(0, 0));
    expect(pointerPose(20, -20, 'avoid')).toEqual(pointerPose(1, -1, 'avoid'));
    expect(pointerPose(NaN, Infinity, 'avoid')).toEqual(trackPose(0, 0));
    expect(Math.abs(pointerPose(1, 0, 'avoid')[0])).toBeLessThan(Math.PI / 3);
  });

  it('preserves the default consultant tracking', () => {
    expect(pointerPose(0.6, -0.4)).toEqual(trackPose(0.6, -0.4));
    expect(pointerPose(-0.9, 0.8, 'follow')).toEqual(trackPose(-0.9, 0.8));
  });
});
