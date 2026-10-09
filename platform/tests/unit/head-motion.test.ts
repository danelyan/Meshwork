import { describe, expect, it } from 'vitest';
import { headMotion, headPose, mouthWeights, neckWeight, portraitZoom } from '../../src/components/head/motion';

describe('head motion', () => {
  it('leaves camera space for the ears in both wide and narrow portrait columns', () => {
    expect(portraitZoom(1)).toBe(1);
    expect(portraitZoom(.6)).toBeCloseTo(2 / 3);
    expect(portraitZoom(.6)).toBeLessThan(portraitZoom(1));
  });
  it('starts with open eyes and no breath displacement', () => {
    expect(headMotion(0)).toEqual({ yaw: 0, pitch: 0, blink: 0, breath: 0 });
    expect(headMotion(Number.NaN)).toEqual(headMotion(0));
  });

  it('closes and opens the eyelids in short pulses with long open intervals', () => {
    expect(headMotion(3.2).blink).toBe(1);
    expect(headMotion(3.14).blink).toBeCloseTo(.5);
    expect(headMotion(3.4).blink).toBe(0);
    expect(headMotion(7.7).blink).toBe(1);
    expect(headMotion(12.2).blink).toBeCloseTo(1);
  });

  it('keeps idle pose subtle and bounded', () => {
    for (let t = 0; t < 60; t += .05) {
      const pose = headMotion(t);
      expect(Math.abs(pose.yaw)).toBeLessThanOrEqual(.024);
      expect(Math.abs(pose.pitch)).toBeLessThanOrEqual(.017);
      expect(Math.abs(pose.breath)).toBeLessThanOrEqual(.0035);
      expect(pose.blink).toBeGreaterThanOrEqual(0);
      expect(pose.blink).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the lower neck fixed and increases rotation smoothly toward the head', () => {
    expect(neckWeight(0)).toBe(0);
    expect(neckWeight(.06)).toBe(0);
    expect(neckWeight(.18)).toBeCloseTo(.5);
    expect(neckWeight(.30)).toBe(1);
    expect(neckWeight(.36)).toBe(1); // The jaw and cheek rotate as a rigid head.
    expect(neckWeight(1)).toBe(1);
    let previous = 0;
    for (let y = 0; y < 1; y += .01) {
      expect(neckWeight(y)).toBeGreaterThanOrEqual(previous);
      previous = neckWeight(y);
    }
  });

  it('centers the source face and limits tracking to gentle fourteen degree turns', () => {
    const center = headPose(0, 0)[0];
    expect(center).toBe(-.54);
    expect(headPose(-1, 0)[0] - center).toBeCloseTo(-.24);
    expect(headPose(1, 0)[0] - center).toBeCloseTo(.24);
    expect(headPose(10, 0)).toEqual(headPose(1, 0));
    expect(headPose(Number.NaN, Number.NaN)).toEqual(headPose(0, 0));
  });

  it('bounds audio mouth weights and discards nonfinite values', () => {
    expect(mouthWeights(.4, .2, .6)).toEqual([.4, .2, .6]);
    expect(mouthWeights(3, -1, Number.NaN)).toEqual([1, 0, 0]);
    expect(mouthWeights(Number.POSITIVE_INFINITY)).toEqual([0, 0, 0]);
  });
});
