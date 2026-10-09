import { readFileSync } from 'node:fs';
import { parseHeadGlb, softenForehead } from '@/components/head/model';
function source() {
  const bytes = readFileSync('public/models/head.glb');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
describe('supplied Tripo head', () => {
  it('loads real geometry and embedded textures', () => {
    const model = parseHeadGlb(source());
    expect(model.positions.length / 3).toBe(52588);
    expect(model.indices.length / 3).toBe(97322);
    expect(model.images.map(image => image.type)).toEqual(['image/jpeg', 'image/jpeg', 'image/png']);
  });
  it('rejects truncated and wrong-format files', () => {
    expect(() => parseHeadGlb(new ArrayBuffer(4))).toThrow('короткий');
    const wrong = source(); new DataView(wrong).setUint32(0, 0);
    expect(() => parseHeadGlb(wrong)).toThrow('заголовок');
    expect(() => parseHeadGlb(source().slice(0, 150))).toThrow();
  });
  it('rejects an out-of-bounds bufferView', () => {
    const original = source(), view = new DataView(original), length = view.getUint32(12, true);
    const data = JSON.parse(new TextDecoder().decode(new Uint8Array(original, 20, length)));
    data.bufferViews[3].byteLength = 999999999;
    const json = new TextEncoder().encode(JSON.stringify(data)), paddedLength = Math.ceil(json.length / 4) * 4;
    const bin = new Uint8Array(original, 20 + length), buffer = new ArrayBuffer(20 + paddedLength + bin.length), header = new DataView(buffer);
    header.setUint32(0, 0x46546c67, true); header.setUint32(4, 2, true); header.setUint32(8, buffer.byteLength, true);
    header.setUint32(12, paddedLength, true); header.setUint32(16, 0x4e4f534a, true);
    const region = new Uint8Array(buffer, 20, paddedLength); region.fill(32); region.set(json);
    new Uint8Array(buffer, 20 + paddedLength).set(bin);
    expect(() => parseHeadGlb(buffer)).toThrow('bufferView');
  });
  it('softens only the forehead, preserving original arrays and lower face', () => {
    const model = parseHeadGlb(source()), original = model.positions.slice(), softened = softenForehead(model);
    expect(model.positions).toEqual(original);
    let changed = 0, unchangedOutsideMask = true;
    for (let i = 0; i < original.length; i += 3) {
      if (original[i + 1]! < .6 || original[i + 2]! < .06) {
        for (let j = 0; j < 3; j++) if (softened[i + j] !== original[i + j]) unchangedOutsideMask = false;
      }
      if (softened[i] !== original[i]) changed++;
    }
    expect(softened.every(Number.isFinite)).toBe(true);
    expect(unchangedOutsideMask).toBe(true);
    expect(changed).toBeGreaterThan(500);
  });
});
