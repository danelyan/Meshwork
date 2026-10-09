import { headPointer } from '@/components/head/pointer';

describe('consultant gaze follows the whole page', () => {
  it('turns toward either column and vertical edges', () => {
    expect(headPointer(0, 0, 1440, 900)).toEqual([-1, 1]);
    expect(headPointer(720, 450, 1440, 900)).toEqual([0, 0]);
    expect(headPointer(1440, 900, 1440, 900)).toEqual([1, -1]);
    expect(headPointer(200, 450, 1440, 900)[0]).toBeLessThan(0);
  });
  it('clamps out-of-viewport input and tolerates a collapsed viewport', () => {
    expect(headPointer(-40, 1000, 800, 800)).toEqual([-1, -1]);
    expect(headPointer(2000, -200, 800, 800)).toEqual([1, 1]);
    expect(headPointer(0, 0, 0, 0).every(Number.isFinite)).toBe(true);
  });
});
