import { readFileSync } from 'node:fs';
import { parseHeadGlb } from '@/components/head/model';
import { headPose, neckWeight, portraitZoom } from '@/components/head/motion';

it('keeps the real model inside the horizontal canvas at both turn limits', () => {
  const bytes = readFileSync('public/models/head-mouth.glb');
  const model = parseHeadGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (const aspect of [.55, .77, 1]) {
    for (const pointer of [-1, 0, 1]) {
      const yaw = headPose(pointer, 0)[0];
      let edge = 0;
      for (let i = 0; i < model.positions.length; i += 3) {
        const x = model.positions[i]!, y = model.positions[i + 1]!, z = model.positions[i + 2]!;
        const weight = neckWeight(y);
        const angle = -.66 * (1 - weight) + yaw * weight;
        const projected = (x * Math.cos(angle) + z * Math.sin(angle)) * 1.72 * portraitZoom(aspect) / aspect;
        edge = Math.max(edge, Math.abs(projected));
      }
      expect(edge).toBeLessThan(.94);
    }
  }
});
