import { readFileSync } from 'node:fs';
import { parseHeadGlb } from '@/components/head/model';
function source() {
  const bytes = readFileSync('public/models/head-mouth.glb');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function withMetadata(change: (data: Record<string, unknown>) => void) {
  const original = source(), view = new DataView(original), length = view.getUint32(12, true);
  const data = JSON.parse(new TextDecoder().decode(new Uint8Array(original, 20, length))) as Record<string, unknown>;
  change(data);
  const json = new TextEncoder().encode(JSON.stringify(data)), padded = Math.ceil(json.length / 4) * 4;
  const bin = new Uint8Array(original, 20 + length), result = new ArrayBuffer(20 + padded + bin.length), header = new DataView(result);
  header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, result.byteLength, true);
  header.setUint32(12, padded, true); header.setUint32(16, 0x4e4f534a, true);
  const text = new Uint8Array(result, 20, padded); text.fill(32); text.set(json);
  new Uint8Array(result, 20 + padded).set(bin);
  return result;
}
describe('Blender facial morph rig', () => {
  it('rejects reordered target names instead of animating the wrong facial muscles', () => {
    const buffer = withMetadata(data => {
      const meshes = data.meshes as { extras: { targetNames: string[] } }[];
      meshes[0]!.extras.targetNames = ['LipRound', 'JawOpen', 'LipWide'];
    });
    expect(() => parseHeadGlb(buffer)).toThrow('формы рта');
  });
  it('rejects mismatched morph vertices', () => {
    const buffer = withMetadata(data => {
      const meshes = data.meshes as { primitives: { targets: { POSITION: number }[] }[] }[];
      const accessors = data.accessors as { count: number }[];
      accessors[meshes[0]!.primitives[0]!.targets[0]!.POSITION]!.count -= 1;
    });
    expect(() => parseHeadGlb(buffer)).toThrow('риг рта');
  });
  it('exports three finite shape targets and real oral surfaces', () => {
    const model = parseHeadGlb(source());
    expect(model.morphs).toHaveLength(3);
    expect(new Set(model.mouthParts)).toEqual(new Set([0, 1, 2, 3]));
    expect(model.indices.some(i => model.mouthParts[i] === 1)).toBe(true);
    for (const morph of model.morphs) {
      expect(morph.positions.length).toBe(model.positions.length);
      expect(morph.normals.length).toBe(model.normals.length);
      expect(morph.positions.every(Number.isFinite)).toBe(true);
      expect(morph.normals.every(Number.isFinite)).toBe(true);
      expect(morph.positions.some(v => Math.abs(v) > .001)).toBe(true);
    }
  });
  it('opens the lower jaw while preserving forehead and neck', () => {
    const model = parseHeadGlb(source()), jaw = model.morphs[0]!;
    let moving = 0, lowerTeeth = 0, upperTeeth = 0;
    for (let i = 0; i < model.positions.length; i += 3) {
      const y = model.positions[i + 1]!, dy = jaw.positions[i + 1]!;
      if (y > .60 || y < .14) expect(jaw.positions.subarray(i, i + 3).every(v => v === 0)).toBe(true);
      if (dy < -.01) moving++;
      if (model.mouthParts[i / 3] === 2) { if (dy < -.01) lowerTeeth++; else if (Math.abs(dy) < 1e-8) upperTeeth++; }
    }
    expect(moving).toBeGreaterThan(100);
    expect(lowerTeeth).toBeGreaterThan(50);
    expect(upperTeeth).toBeGreaterThan(50);
  });
  it('narrows and widens the lips in opposite directions', () => {
    const model = parseHeadGlb(source());
    const round = model.morphs[1]!, wide = model.morphs[2]!;
    let opposite = 0;
    for (let i = 0; i < model.positions.length; i += 3) {
      if (model.mouthParts[i / 3] !== 0) continue;
      const r = round.positions[i]! * .858 - round.positions[i + 2]! * .514;
      const w = wide.positions[i]! * .858 - wide.positions[i + 2]! * .514;
      if (r * w < -1e-7) opposite++;
    }
    expect(opposite).toBeGreaterThan(100);
  });
});
