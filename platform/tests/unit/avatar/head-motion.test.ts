import { describe, expect, it } from 'vitest';

import { headPose } from '../../../src/components/head/motion';
import {
  BASE_YAW,
  easeToward,
  HEAD_MOTION_MODES,
  isHeadMotionMode,
  livePose,
  NECK,
  neckPose,
  neckWeight,
  PITCH_DOWN,
  PITCH_UP,
  trackPointer,
  trackPose,
  TRACK_GAIN,
} from '../../../src/components/avatar/head-motion';
import { HEAD_MODEL } from '../../../src/components/avatar/Head3D';

describe('avatar head motion (Karina tracking on our model)', () => {
  it('drops the mesh-orientation compensation: centred cursor faces the camera', () => {
    expect(trackPose(0, 0)[0]).toBeCloseTo(0);
    expect(trackPose(0, 0)[1]).toBeCloseTo(headPose(0, 0)[1]);
  });

  it('keeps Karina limits and signs: yaw ±0.24 to the cursor side, look up when the cursor is above', () => {
    expect(trackPose(1, 0)[0]).toBeCloseTo(0.24 * TRACK_GAIN);
    expect(trackPose(-5, 0)[0]).toBeCloseTo(-0.24 * TRACK_GAIN);
    expect(trackPose(0, 1)[1]).toBeLessThan(trackPose(0, -1)[1]);
    expect(trackPose(0, 1)[1] - trackPose(0, -1)[1]).toBeCloseTo(-(PITCH_UP + PITCH_DOWN));
  });

  it('looks down noticeably when the cursor is under the head (owner 10.10)', () => {
    const p0 = trackPose(0, 0)[1];
    expect(trackPose(0, -1)[1] - p0).toBeCloseTo(PITCH_DOWN);
    expect(PITCH_DOWN).toBeGreaterThan(0.3);
    expect(p0 - trackPose(0, 1)[1]).toBeCloseTo(PITCH_UP);
    expect(trackPose(0, -9)[1]).toBeCloseTo(trackPose(0, -1)[1]);
  });

  it('normalises vertical distance to the window edge on that side, not to the full height', () => {
    // голова в верхней трети: центр 250 из 800 по высоте
    expect(trackPointer(500, 800, 1000, 800, 500, 250)).toEqual([0, -1]);
    expect(trackPointer(500, 0, 1000, 800, 500, 250)).toEqual([0, 1]);
    expect(trackPointer(500, 525, 1000, 800, 500, 250)[1]).toBeCloseTo(-0.5);
    expect(trackPointer(1000, 250, 1000, 800, 500, 250)).toEqual([1, 0]);
    expect(trackPointer(500, 2000, 1000, 800, 500, 250)[1]).toBe(-1);
  });

  it('turns the neck, not the shoulders: base fixed, chin and jaw rigid', () => {
    expect(neckWeight(0)).toBe(0);
    expect(neckWeight(NECK.from)).toBe(0);
    expect(neckWeight(HEAD_MODEL.chinY)).toBeGreaterThan(0.95);
    expect(neckWeight(0.33)).toBe(1);
    expect(neckWeight(HEAD_MODEL.mouthY)).toBe(1);
    expect(neckWeight(0.15)).toBeGreaterThan(neckWeight(0.1));
    expect(NECK.pivotY).toBeLessThan(HEAD_MODEL.chinY);
  });

  it('eases like Karina, independent of frame rate', () => {
    expect(easeToward(0, 1, 0)).toBe(0);
    expect(easeToward(0, 1, 0.1)).toBeCloseTo(1 - Math.exp(-0.52));
    let a = 0;
    for (let i = 0; i < 2; i++) a = easeToward(a, 1, 0.05);
    expect(a).toBeCloseTo(easeToward(0, 1, 0.1));
    expect(easeToward(0, 1, 10)).toBeCloseTo(easeToward(0, 1, 0.1));
  });

  it('neck pose: centred cursor at rest looks at the camera relative to the turned base', () => {
    const [yaw, pitch, roll, breath] = neckPose({ pose: [0, 0], time: 0, thinking: false, level: 0 });
    expect(yaw + BASE_YAW).toBeCloseTo(0);
    expect(pitch).toBeCloseTo(0);
    expect(roll).toBe(0);
    expect(breath).toBe(0);
    const think = neckPose({ pose: [0, 0], time: 0, thinking: true, level: 0 });
    expect(think[1]).toBeGreaterThan(0);
    expect(think[2]).toBeGreaterThan(0);
  });

  it('live pose stays bounded', () => {
    const live = livePose({ gaze: [3, -3], smile: 1, open: 1, thinking: false });
    expect(live).toEqual([1, -1, 1, 0.4]);
    expect(livePose({ gaze: [0, 0], smile: 0, open: 0, thinking: true })[3]).toBe(1);
  });

  it('exposes the three demo modes', () => {
    expect(HEAD_MOTION_MODES.map((m) => m.id)).toEqual(['classic', 'karina', 'alive']);
    expect(isHeadMotionMode('alive')).toBe(true);
    expect(isHeadMotionMode('x')).toBe(false);
  });
});
