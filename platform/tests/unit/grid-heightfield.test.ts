import { readFileSync } from 'node:fs';

import { rasterizeHeightfield } from '../../public/design/consultant-grid-v2/grid-heightfield.mjs';

it('keeps a lip edge continuous when it crosses a heightfield sample', () => {
  const sample = (shift: number) => {
    const points = new Float32Array([2 + shift, 0, 0.3, 2 + shift, 4, 0.3, 4 + shift, 2, 0.3]);
    return rasterizeHeightfield(points, [0, 1, 2], 7, 7, new Float32Array(49))[16]!;
  };
  // A tiny turn used to make this sample jump from 0.3 straight to zero.
  expect(Math.abs(sample(-0.001) - sample(0.001))).toBeLessThan(0.00001);
  expect(sample(0.5)).toBeCloseTo(0.15);
  expect(sample(1.001)).toBe(0);
});

it('preserves shared triangle edges and never extrapolates a steep lip plane', () => {
  const points = new Float32Array([1, 1, 0.3, 5, 1, 0.3, 5, 5, 0.3, 1, 5, 0.3]);
  const heights = rasterizeHeightfield(points, [0, 1, 2, 0, 2, 3], 7, 7, new Float32Array(49));
  for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) expect(heights[y * 7 + x]).toBeCloseTo(0.3);
  const steep = new Float32Array([2, 1, 0, 2.001, 5, 0.4, 2.002, 1, 0.2]);
  rasterizeHeightfield(steep, [0, 1, 2], 7, 7, heights);
  expect([...heights].every(z => Number.isFinite(z) && z >= 0 && z <= 0.400001)).toBe(true);
});

it('keeps an edge-on triangle visible instead of discarding its silhouette', () => {
  const points = new Float32Array([2, 1, 0.3, 2, 5, 0.3, 2, 3, 0.3]);
  const heights = rasterizeHeightfield(points, [0, 1, 2], 7, 7, new Float32Array(49));
  expect(heights[3 * 7 + 2]).toBeCloseTo(0.3);
  expect([...heights].every(Number.isFinite)).toBe(true);
});

it('avoids depth pops around the real upper lip at a full right turn', () => {
  const html = readFileSync('public/design/consultant-grid-v1/index.html', 'utf8');
  const model = JSON.parse(html.match(/window\.__HEAD=(\{.*?\});?<\/script>/)![1]!) as { v: number[]; t: number[] };
  const points = new Float32Array(model.v.length);
  const heights = new Float32Array(201 * 235);
  let previous: Float32Array | undefined;
  let largestChange = 0;
  // Small idle pitch changes continue even while the pointer is held at the edge.
  for (let frame = 0; frame <= 200; frame++) {
    const pitch = -0.01 + frame * 0.0001, yaw = 0.5;
    for (let i = 0; i < model.v.length; i += 3) {
      const x = model.v[i]!, y = model.v[i + 1]! - 0.55, z = model.v[i + 2]!;
      const a = Math.max(0, Math.min(1, (y + 0.49) / 0.29));
      const weight = a * a * (3 - 2 * a);
      const py = (y + 0.33) * Math.cos(pitch) - (z + 0.04) * Math.sin(pitch);
      const pz = (y + 0.33) * Math.sin(pitch) + (z + 0.04) * Math.cos(pitch);
      points[i] = (x + (x * Math.cos(yaw) + pz * Math.sin(yaw) - x) * weight + 0.5) / 0.005;
      points[i + 1] = (y + (py - y - 0.33) * weight + 0.62) / 0.005;
      points[i + 2] = z + (-x * Math.sin(yaw) + pz * Math.cos(yaw) - z - 0.04) * weight;
    }
    rasterizeHeightfield(points, model.t, 201, 235, heights);
    if (previous) for (let y = 98; y <= 110; y++) for (let x = 100; x <= 160; x++) {
      const index = y * 201 + x;
      largestChange = Math.max(largestChange, Math.abs(heights[index]! - previous[index]!));
    }
    previous = heights.slice();
  }
  expect(largestChange).toBeLessThan(0.005);
});
