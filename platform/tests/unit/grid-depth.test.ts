import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

import { drawDepthAndGrid, surfaceTopology } from '../../public/design/consultant-grid-v2/grid-webgl.mjs';
import { stabilizeHeightmap } from '../../public/design/consultant-grid-v2/grid-stability.mjs';

it('draws the invisible surface before grid colors without writing a head silhouette', () => {
  const operations: unknown[][] = [];
  const gl = {
    DEPTH_TEST: 1, LEQUAL: 2, BLEND: 3, TRIANGLES: 4, UNSIGNED_INT: 5,
    SRC_ALPHA: 6, ONE_MINUS_SRC_ALPHA: 7, ONE: 8,
    ...Object.fromEntries(['enable', 'disable', 'depthFunc', 'depthMask', 'colorMask', 'uniform1i', 'drawElements', 'blendFuncSeparate']
      .map(name => [name, (...args: unknown[]) => operations.push([name, ...args])])),
  };
  drawDepthAndGrid(gl as unknown as WebGL2RenderingContext, 60, null);
  const firstDraw = operations.findIndex(o => o[0] === 'drawElements');
  expect(operations.slice(0, firstDraw)).toContainEqual(['colorMask', false, false, false, false]);
  expect(operations.slice(0, firstDraw)).toContainEqual(['depthMask', true]);
  expect(operations.slice(firstDraw + 1)).toContainEqual(['colorMask', true, true, true, true]);
  expect(operations.slice(firstDraw + 1)).toContainEqual(['depthMask', false]);
  expect(operations).toContainEqual(['depthFunc', gl.LEQUAL]);
  expect(operations.filter(o => o[0] === 'drawElements')).toEqual([
    ['drawElements', gl.TRIANGLES, 60, gl.UNSIGNED_INT, 0],
    ['drawElements', gl.TRIANGLES, 60, gl.UNSIGNED_INT, 0],
  ]);
});

it('joins the relief and background into a single manifold sheet without duplicate seams', () => {
  const { vertices, indices } = surfaceTopology(4, 5);
  expect(vertices.length / 2).toBe(6 * 7);
  const edges = new Map<string, number>();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t]!, b = indices[t+1]!, c = indices[t+2]!;
    expect(Math.max(a, b, c)).toBeLessThan(vertices.length / 2);
    const cross = (vertices[b*2]! - vertices[a*2]!) * (vertices[c*2+1]! - vertices[a*2+1]!)
      - (vertices[b*2+1]! - vertices[a*2+1]!) * (vertices[c*2]! - vertices[a*2]!);
    expect(cross).toBeGreaterThan(0);
    for (const [i,j] of [[a,b],[b,c],[c,a]]) {
      const key = [i,j].sort((x,y) => x!-y!).join(':'); edges.set(key, (edges.get(key) ?? 0)+1);
    }
  }
  expect([...edges.values()].every(n => n === 1 || n === 2)).toBe(true);
  expect([...edges.values()].filter(n => n === 1)).toHaveLength(2*(5+6));
});

it('keeps the accepted v1 document byte-for-byte intact', () => {
  const baseline = JSON.parse(readFileSync('design-baselines/consultant-grid-v1/manifest.json', 'utf8'));
  const file = 'public/design/consultant-grid-v1/index.html';
  expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(baseline.hashes[file]);
});

it('stabilizes a newly covered lip cell without a one-frame pop or overshoot', () => {
  const previous = new Float32Array([0, 0.3]);
  const target = new Float32Array([0.3, 0]);
  stabilizeHeightmap(previous, target, 16, true);
  expect(previous[0]).toBeGreaterThan(0);
  expect(previous[0]).toBeLessThan(0.2);
  expect(previous[1]).toBeGreaterThan(0);
  for (let i = 0; i < 15; i++) stabilizeHeightmap(previous, target, 16, true);
  expect(previous[0]).toBeCloseTo(0.3, 4);
  expect(previous[1]).toBeCloseTo(0, 4);
});

it('keeps temporal smoothing consistent at different frame rates and loads the first frame instantly', () => {
  const target = new Float32Array([0.4]);
  const a = new Float32Array(1), b = new Float32Array(1);
  stabilizeHeightmap(a, target, 32, true);
  stabilizeHeightmap(b, target, 16, true);
  stabilizeHeightmap(b, target, 16, true);
  expect(a[0]).toBeCloseTo(b[0]!, 6);
  stabilizeHeightmap(a, target, 0, false);
  expect(a[0]).toBe(target[0]);
});
