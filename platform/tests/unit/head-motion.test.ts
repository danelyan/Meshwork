import { sheetMotion } from '@/components/head/motion';

describe('grid sheet motion', () => {
  it('stays still for reduced-motion at any time', () => {
    expect(sheetMotion(4700, true)).toEqual({ yaw: 0, pitch: 0, breath: 0, blink: 0 });
    expect(sheetMotion(20000, true)).toEqual(sheetMotion(0, true));
  });

  it('adds a brief blink, separated by a long open-eye interval', () => {
    expect(sheetMotion(4700, false).blink).toBeCloseTo(1);
    expect(sheetMotion(4000, false).blink).toBe(0);
    expect(sheetMotion(5000, false).blink).toBe(0);
    expect(sheetMotion(10500, false).blink).toBeCloseTo(1);
  });

  it('bounds every idle movement and changes the pose over time', () => {
    for (let time = 0; time <= 20000; time += 137) {
      const motion = sheetMotion(time, false);
      expect(Math.abs(motion.yaw)).toBeLessThanOrEqual(.055);
      expect(Math.abs(motion.pitch)).toBeLessThanOrEqual(.028);
      expect(Math.abs(motion.breath)).toBeLessThanOrEqual(.007);
      expect(motion.blink).toBeGreaterThanOrEqual(0);
      expect(motion.blink).toBeLessThanOrEqual(1);
    }
    expect(sheetMotion(2000, false)).not.toEqual(sheetMotion(0, false));
  });
});
