import { BufferAttribute, type BufferGeometry } from 'three';

/**
 * Поле «ретопологии» для `weave5`/`weave8`: per-vertex атрибут `fspField` = (d, черта).
 *
 * - d — расстояние по поверхности (Дейкстра по рёбрам сетки, потом сглаживание по соседям) до ближайшей
 *   черты: миндаль глаза или контур губ. Изолинии d — петли вокруг черт, которые сливаются в общие
 *   кольца вокруг маски лица и дальше по черепу (как edge-loops ретопологии); 3D-расстояние так не
 *   умеет — оно режет нос и переносицу напрямик.
 * - черта — номер ближайшей (0 глаз Л, 1 глаз П, 2 рот): шейдер берёт её центр для спиц у контура.
 *
 * Угол спиц считается в шейдере (лучи из центра черты, дальше — вокруг оси лица): угол, унаследованный
 * Дейкстрой от источника, на рёбрах сетки получался зубчатым («потрескавшаяся глина»).
 * Считается один раз на геометрию (≈ 54 тыс. вершин, ≈ 0.15 с) и кешируется в ней самой.
 * Координаты — модели head-mouth.glb (лицо +Z, высота 0…1).
 */
export const WEAVE_FIELD_ATTR = 'fspField';

/** Черты: центр, полуоси эллипса во фронтальной плоскости XY, вершины не глубже c.z. */
export const FEATURES: readonly { c: [number, number, number]; ab: [number, number] }[] = [
  { c: [-0.115, 0.632, 0.27], ab: [0.052, 0.026] },
  { c: [0.115, 0.632, 0.27], ab: [0.052, 0.026] },
  { c: [0.0, 0.432, 0.36], ab: [0.07, 0.02] },
];

/** Номер черты, внутри которой лежит вершина, или −1. */
function seed(x: number, y: number, z: number): number {
  for (let f = 0; f < FEATURES.length; f++) {
    const { c, ab } = FEATURES[f]!;
    if (z < c[2]) continue;
    const qx = (x - c[0]) / ab[0];
    const qy = (y - c[1]) / ab[1];
    if (qx * qx + qy * qy <= 1) return f;
  }
  return -1;
}

/** Двоичная куча по ключу dist[i] (для Дейкстры без внешних зависимостей). */
export class Heap {
  private a: number[] = [];
  constructor(private key: Float64Array) {}
  get size() {
    return this.a.length;
  }
  push(i: number) {
    const a = this.a;
    a.push(i);
    let n = a.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (this.key[a[p]!]! <= this.key[a[n]!]!) break;
      [a[p], a[n]] = [a[n]!, a[p]!];
      n = p;
    }
  }
  pop(): number {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        const r = l + 1;
        let m = n;
        if (l < a.length && this.key[a[l]!]! < this.key[a[m]!]!) m = l;
        if (r < a.length && this.key[a[r]!]! < this.key[a[m]!]!) m = r;
        if (m === n) break;
        [a[m], a[n]] = [a[n]!, a[m]!];
        n = m;
      }
    }
    return top;
  }
}

/**
 * Граф сетки по «узлам»: совпадающие вершины (швы нормалей в GLB) сварены, части рта (`_mouth_part`)
 * исключены. Смежность — CSR (`deg` — смещения, `adj` — соседи). Общий для weave-field и weave-lines.
 */
export function weldGraph(g: BufferGeometry) {
  const pos = g.getAttribute('position');
  const index = g.getIndex()!;
  const part = g.getAttribute('_mouth_part');
  const n = pos.count;
  const node = new Int32Array(n);
  const weld = new Map<string, number>();
  const nodePos: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * 1e5)},${Math.round(pos.getY(i) * 1e5)},${Math.round(pos.getZ(i) * 1e5)}`;
    let k = weld.get(key);
    if (k === undefined) {
      k = nodePos.length / 3;
      weld.set(key, k);
      nodePos.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    node[i] = k;
  }
  const m = nodePos.length / 3;
  const skip = new Uint8Array(m);
  if (part) for (let i = 0; i < n; i++) if (part.getX(i) > 0.5) skip[node[i]!] = 1;

  // смежность (CSR)
  const deg = new Int32Array(m + 1);
  const idx = index.array;
  const edges: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = node[idx[t + e]!]!;
      const b = node[idx[t + ((e + 1) % 3)]!]!;
      if (a === b || skip[a] || skip[b]) continue;
      edges.push(a, b);
      deg[a + 1]!++;
      deg[b + 1]!++;
    }
  }
  for (let i = 0; i < m; i++) deg[i + 1]! += deg[i]!;
  const adj = new Int32Array(deg[m]!);
  const fill = deg.slice(0, m);
  for (let e = 0; e < edges.length; e += 2) {
    const a = edges[e]!;
    const b = edges[e + 1]!;
    adj[fill[a]!++] = b;
    adj[fill[b]!++] = a;
  }

  return { node, nodePos, m, skip, deg, adj };
}

/** Добавляет `fspField` в геометрию (если его ещё нет). Возвращает false, если сетка без индекса. */
export function addWeaveField(g: BufferGeometry): boolean {
  if (g.getAttribute(WEAVE_FIELD_ATTR)) return true;
  if (!g.getAttribute('position') || !g.getIndex()) return false;
  const n = g.getAttribute('position').count;

  const { node, nodePos, m, skip, deg, adj } = weldGraph(g);

  // Дейкстра от всех вершин внутри черт сразу; каждая вершина наследует черту источника
  const dist = new Float64Array(m).fill(Infinity);
  const feat = new Int8Array(m).fill(-1);
  const heap = new Heap(dist);
  for (let k = 0; k < m; k++) {
    if (skip[k]) continue;
    const f = seed(nodePos[k * 3]!, nodePos[k * 3 + 1]!, nodePos[k * 3 + 2]!);
    if (f < 0) continue;
    dist[k] = 0;
    feat[k] = f;
    heap.push(k);
  }
  const done = new Uint8Array(m);
  while (heap.size) {
    const a = heap.pop();
    if (done[a]) continue;
    done[a] = 1;
    const ax = nodePos[a * 3]!;
    const ay = nodePos[a * 3 + 1]!;
    const az = nodePos[a * 3 + 2]!;
    for (let j = deg[a]!; j < deg[a + 1]!; j++) {
      const b = adj[j]!;
      if (done[b]) continue;
      const d = dist[a]! + Math.hypot(nodePos[b * 3]! - ax, nodePos[b * 3 + 1]! - ay, nodePos[b * 3 + 2]! - az);
      if (d < dist[b]!) {
        dist[b] = d;
        feat[b] = feat[a]!;
        heap.push(b);
      }
    }
  }

  // сглаживание по соседям: граф рёбер даёт «ступенчатое» расстояние; внутри черт d = 0 остаётся
  let d0 = Float64Array.from(dist, (x) => (Number.isFinite(x) ? x : 0));
  for (let it = 0; it < 30; it++) {
    const d1 = new Float64Array(m);
    for (let a = 0; a < m; a++) {
      if (dist[a] === 0) continue;
      let sd = d0[a]!;
      for (let j = deg[a]!; j < deg[a + 1]!; j++) sd += d0[adj[j]!]!;
      d1[a] = sd / (deg[a + 1]! - deg[a]! + 1);
    }
    d0 = d1;
  }

  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = d0[node[i]!]!;
    out[i * 2 + 1] = Math.max(0, feat[node[i]!]!);
  }
  g.setAttribute(WEAVE_FIELD_ATTR, new BufferAttribute(out, 2));
  return true;
}
