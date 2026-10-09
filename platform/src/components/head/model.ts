import { z } from 'zod';

const index = z.number().int().nonnegative();
const schema = z.object({
  asset: z.object({ version: z.literal('2.0') }),
  bufferViews: z.array(z.object({ buffer: z.literal(0), byteOffset: index.default(0), byteLength: index, byteStride: index.optional() })),
  accessors: z.array(z.object({ bufferView: index, byteOffset: index.default(0), componentType: z.number(), count: index, type: z.string() })),
  meshes: z.array(z.object({ primitives: z.array(z.object({ mode: z.literal(4).default(4), indices: index, attributes: z.object({ POSITION: index, NORMAL: index, TEXCOORD_0: index }) })) })),
  images: z.array(z.object({ bufferView: index, mimeType: z.enum(['image/png', 'image/jpeg']) })),
});

export type HeadModel = { positions: Float32Array; normals: Float32Array; uv: Float32Array; indices: Uint32Array; images: Blob[] };

/** Reader for the supplied, uncompressed, single-mesh Tripo GLB; unsupported layouts fail explicitly. */
export function parseHeadGlb(buffer: ArrayBuffer): HeadModel {
  if (buffer.byteLength < 28) throw new Error('GLB слишком короткий');
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('Некорректный заголовок GLB');
  const jsonLength = view.getUint32(12, true);
  const binHeader = 20 + jsonLength;
  if (view.getUint32(16, true) !== 0x4e4f534a || binHeader + 8 > buffer.byteLength || view.getUint32(binHeader + 4, true) !== 0x004e4942) throw new Error('Отсутствуют JSON/BIN секции GLB');
  const data = schema.parse(JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength))));
  const binStart = binHeader + 8;
  const binLength = view.getUint32(binHeader, true);
  if (binStart + binLength !== buffer.byteLength) throw new Error('Некорректный размер BIN');
  const bytes = (i: number) => {
    const b = data.bufferViews[i];
    if (!b || b.byteOffset + b.byteLength > binLength || b.byteStride) throw new Error('Неподдерживаемый bufferView');
    return buffer.slice(binStart + b.byteOffset, binStart + b.byteOffset + b.byteLength);
  };
  const floats = (i: number, type: 'VEC2' | 'VEC3') => {
    const a = data.accessors[i];
    if (!a || a.type !== type || a.componentType !== 5126) throw new Error('Неподдерживаемый атрибут');
    const b = bytes(a.bufferView), length = a.count * (type === 'VEC3' ? 3 : 2);
    if (a.byteOffset % 4 || a.byteOffset + length * 4 > b.byteLength) throw new Error('Атрибут выходит за границы');
    const result = new Float32Array(b, a.byteOffset, length).slice();
    if (result.some(v => !Number.isFinite(v))) throw new Error('Неконечные координаты');
    return result;
  };
  const primitive = data.meshes[0]?.primitives[0];
  if (!primitive || data.meshes.length !== 1 || data.meshes[0]?.primitives.length !== 1) throw new Error('Ожидалась одна сетка');
  const positions = floats(primitive.attributes.POSITION, 'VEC3');
  const normals = floats(primitive.attributes.NORMAL, 'VEC3');
  const uv = floats(primitive.attributes.TEXCOORD_0, 'VEC2');
  const a = data.accessors[primitive.indices];
  if (!a || a.type !== 'SCALAR' || ![5123, 5125].includes(a.componentType) || a.count % 3) throw new Error('Некорректные треугольники');
  const b = bytes(a.bufferView), width = a.componentType === 5125 ? 4 : 2;
  if (a.byteOffset % width || a.byteOffset + a.count * width > b.byteLength) throw new Error('Индексы выходят за границы');
  const indices = Uint32Array.from(width === 4 ? new Uint32Array(b, a.byteOffset, a.count) : new Uint16Array(b, a.byteOffset, a.count));
  if (positions.length !== normals.length || uv.length / 2 !== positions.length / 3 || indices.some(v => v >= positions.length / 3)) throw new Error('Несогласованные атрибуты');
  return { positions, normals, uv, indices, images: data.images.map(image => new Blob([bytes(image.bufferView)], { type: image.mimeType })) };
}

/** Weld UV seams for adjacency, then soften only the front forehead. Original arrays are never mutated. */
export function softenForehead(model: HeadModel): Float32Array {
  const p = model.positions, welded = new Map<string, number>(), vertex = new Uint32Array(p.length / 3);
  const unique: number[] = [];
  for (let i = 0; i < vertex.length; i++) {
    const key = [p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!].map(v => Math.round(v * 100000)).join(',');
    let id = welded.get(key);
    if (id === undefined) { id = unique.length / 3; welded.set(key, id); unique.push(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!); }
    vertex[i] = id;
  }
  const adjacent = Array.from({ length: unique.length / 3 }, () => new Set<number>());
  for (let i = 0; i < model.indices.length; i += 3) {
    const ids = [vertex[model.indices[i]!]!, vertex[model.indices[i + 1]!]!, vertex[model.indices[i + 2]!]!];
    for (const a of ids) for (const b of ids) if (a !== b) adjacent[a]!.add(b);
  }
  let current = Float32Array.from(unique);
  const weights = adjacent.map((_, i) => {
    const x = current[i * 3]!, y = current[i * 3 + 1]!, z = current[i * 3 + 2]!;
    // Wide feathered mask; below the forehead and the back of the head remain untouched.
    const edge = Math.max(0, 1 - (x / .23) ** 2 - ((y - .79) / .19) ** 2);
    return edge * edge * Math.max(0, Math.min(1, (z - .06) / .12)) * .65;
  });
  for (let step = 0; step < 32; step++) {
    const next = current.slice();
    adjacent.forEach((neighbors, i) => {
      const w = weights[i]!;
      if (!w || !neighbors.size) return;
      for (let axis = 0; axis < 3; axis++) {
        let sum = 0; for (const j of neighbors) sum += current[j * 3 + axis]!;
        next[i * 3 + axis] = current[i * 3 + axis]! * (1 - w) + sum / neighbors.size * w;
      }
    });
    current = next;
  }
  const result = p.slice();
  vertex.forEach((id, i) => { if (weights[id]! > 0) result.set(current.subarray(id * 3, id * 3 + 3), i * 3); });
  return result;
}

/** Rebuild local repair normals so the old dent does not survive in the lighting. */
export function repairedNormals(model: HeadModel, positions: Float32Array): Float32Array {
  const sums = new Float32Array(positions.length);
  for (let i = 0; i < model.indices.length; i += 3) {
    const a = model.indices[i]! * 3, b = model.indices[i + 1]! * 3, c = model.indices[i + 2]! * 3;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
    for (const j of [a, b, c]) { sums[j] = sums[j]! + uy * vz - uz * vy; sums[j + 1] = sums[j + 1]! + uz * vx - ux * vz; sums[j + 2] = sums[j + 2]! + ux * vy - uy * vx; }
  }
  const groups = new Map<string, [number, number, number]>();
  const key = (i: number) => [positions[i]!, positions[i + 1]!, positions[i + 2]!].map(v => Math.round(v * 100000)).join(',');
  for (let i = 0; i < positions.length; i += 3) {
    const k = key(i), sum = groups.get(k) ?? [0, 0, 0];
    sum[0] += sums[i]!; sum[1] += sums[i + 1]!; sum[2] += sums[i + 2]!; groups.set(k, sum);
  }
  const result = model.normals.slice();
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] === model.positions[i] && positions[i + 1] === model.positions[i + 1] && positions[i + 2] === model.positions[i + 2]) continue;
    const sum = groups.get(key(i))!, length = Math.hypot(...sum);
    if (length > 1e-10) result.set(sum.map(v => v / length), i);
  }
  return result;
}
