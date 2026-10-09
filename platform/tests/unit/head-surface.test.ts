import { readFileSync } from 'node:fs';
import { parseHeadGlb } from '@/components/head/model';
import { smoothMetalSurface } from '@/components/head/surface';

it('smooths the surface without mutating geometry or changing oral parts', () => {
  const bytes = readFileSync('public/models/head-mouth.glb');
  const model = parseHeadGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const original = model.positions.slice();
  const result = smoothMetalSurface(model, original);
  expect(model.positions).toEqual(original);
  let changed = 0;
  for (let i = 0; i < model.mouthParts.length; i++) {
    if (model.mouthParts[i]! > 0) expect(Array.from(result.subarray(i * 3, i * 3 + 3))).toEqual(Array.from(original.subarray(i * 3, i * 3 + 3)));
    else if (result[i * 3] !== original[i * 3]) changed++;
  }
  expect(changed).toBeGreaterThan(10000);
  expect(result.every(Number.isFinite)).toBe(true);
});
