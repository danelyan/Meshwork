import type { HeadModel } from './model';

/** Remove embossed microgeometry while preserving the mouth rig and eyelids. */
export function smoothMetalSurface(model: HeadModel, initial: Float32Array): Float32Array {
  const ids = new Uint32Array(initial.length / 3), welded = new Map<string, number>();
  const values: number[] = [], parts: number[] = [];
  for (let i = 0; i < ids.length; i++) {
    const p = initial.subarray(i * 3, i * 3 + 3), part = model.mouthParts[i] ?? 0;
    const key = `${part}:${Array.from(p, v => Math.round(v * 100000)).join(',')}`;
    let id = welded.get(key);
    if (id === undefined) { id = values.length / 3; welded.set(key, id); values.push(...p); parts.push(part); }
    ids[i] = id;
  }
  const adjacent = Array.from({ length: values.length / 3 }, () => new Set<number>());
  for (let i = 0; i < model.indices.length; i += 3) {
    const triangle = [ids[model.indices[i]!]!, ids[model.indices[i + 1]!]!, ids[model.indices[i + 2]!]!];
    for (const a of triangle) for (const b of triangle) if (a !== b) adjacent[a]!.add(b);
  }
  const weight = adjacent.map((_, i) => {
    if (parts[i]! > 0) return 0;
    const x = values[i * 3]!, y = values[i * 3 + 1]!, z = values[i * 3 + 2]!;
    const faceX = x * .858 - z * .514, depth = x * .514 + z * .858;
    if (depth > .2 && Math.abs(faceX) < .12 && y > .38 && y < .52) return 0;
    if (depth > .2 && Math.abs(faceX) > .065 && Math.abs(faceX) < .145 && y > .61 && y < .67) return 0;
    return .48;
  });
  let current = Float32Array.from(values);
  // Alternating smoothing / inflation avoids shrinking the facial silhouette.
  for (let pass = 0; pass < 25; pass++) {
    for (const sign of [1, -.92]) {
      const next = current.slice();
      adjacent.forEach((neighbors, i) => {
        if (!weight[i] || !neighbors.size) return;
        for (let axis = 0; axis < 3; axis++) {
          let sum = 0; for (const j of neighbors) sum += current[j * 3 + axis]!;
          next[i * 3 + axis] = current[i * 3 + axis]! + (sum / neighbors.size - current[i * 3 + axis]!) * weight[i]! * sign;
        }
      });
      current = next;
    }
  }
  const result = initial.slice();
  ids.forEach((id, i) => result.set(current.subarray(id * 3, id * 3 + 3), i * 3));
  return result;
}
