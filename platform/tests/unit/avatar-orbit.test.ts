import { describe, expect, it } from 'vitest';

import { OrbitState } from '@/app/design/avatar/orbit';

describe('OrbitState', () => {
  it('drag shifts yaw and pitch and clamps them', () => {
    const o = new OrbitState();
    o.begin(0, 0, 0);
    o.drag(100, 50, 16);
    const a = o.read(16);
    expect(a.yaw).toBeCloseTo(0.8);
    expect(a.pitch).toBeCloseTo(0.3);
    o.drag(10_000, 10_000, 32);
    expect(o.read(32)).toEqual({ yaw: 1.4, pitch: 0.7 });
  });

  it('coasts after release and decays; stationary release has no inertia', () => {
    const o = new OrbitState();
    o.begin(0, 0, 0);
    o.drag(20, 0, 16);
    o.end(20);
    const a = o.read(20);
    const b = o.read(120);
    expect(b.yaw).toBeGreaterThan(a.yaw);
    const s = new OrbitState();
    s.begin(0, 0, 0);
    s.drag(20, 0, 16);
    s.end(500);
    const c = s.read(500);
    expect(s.read(600).yaw).toBe(c.yaw);
  });

  it('reset returns to zero', () => {
    const o = new OrbitState();
    o.nudge(0.5, 0.2);
    o.reset();
    expect(o.read(0)).toEqual({ yaw: 0, pitch: 0 });
  });
});
