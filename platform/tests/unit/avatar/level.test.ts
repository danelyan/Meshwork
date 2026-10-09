import { mouthOpen, rms, smoothLevel } from '@/components/avatar/level';

describe('громкость → рот', () => {
  it('rms', () => {
    expect(rms([])).toBe(0);
    expect(rms(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
    expect(rms(new Float32Array(128))).toBe(0);
  });

  it('сглаживание: быстрый рост, медленный спад, не зависит от шага кадра', () => {
    const up = smoothLevel(0, 1, 1 / 60);
    const down = smoothLevel(1, 0, 1 / 60);
    expect(up).toBeGreaterThan(0.3);
    expect(1 - down).toBeLessThan(up); // закрывается медленнее, чем открывается
    // 2 кадра по 1/120 ≈ 1 кадр 1/60
    expect(smoothLevel(smoothLevel(0, 1, 1 / 120), 1, 1 / 120)).toBeCloseTo(up, 5);
    expect(smoothLevel(0.4, 1, 0)).toBe(0.4);
    expect(smoothLevel(0.4, 1, Number.NaN)).toBe(0.4);
  });

  it('порог тишины и насыщение', () => {
    expect(mouthOpen(0)).toBe(0);
    expect(mouthOpen(0.01)).toBe(0);
    expect(mouthOpen(0.1)).toBeGreaterThan(0);
    expect(mouthOpen(0.1)).toBeLessThan(1);
    expect(mouthOpen(0.5)).toBe(1);
    expect(mouthOpen(Number.NaN)).toBe(0);
  });
});
