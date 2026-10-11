import { BufferAttribute, type BufferGeometry } from 'three';

import { FEATURES, Heap, weldGraph } from './weave-field';

/**
 * Поле линий для «Плетения 9» («Проволока на линиях ретопологии»): per-vertex атрибуты
 * `fspLine` = (D, cos ψ, sin ψ, G) и `fspLineF` = (номер черты: 0/1 глаза, 2 рот; зазор до соседней
 * области – 0 на шве между областями черт).
 *
 * - D – расстояние до черт (глаз, губ) по поверхности в метрике с плотностью ρ: на маске лица
 *   ρ = 1.5, на черепе 1, переход плавный. Кольца нити – изолинии D, поэтому лицо в ~1,5 раза
 *   плотнее черепа. У самих черт (до `ZONE`) D – аналитический овал (точка лежит на эллипсе с
 *   полуосями a + D, b + D): кольца – овалы, а не полукруги вокруг узких уголков губ и глаз
 *   («мишени» на краях губ у `weave5`). Дальше – метод тепла (Crane et al. 2013) с этими значениями
 *   на источниках: расстояние Дейкстры по рёбрам зубчатое, кольца шли «волной».
 * - ψ – метка спицы: угол на контуре черты по длине дуги, дальше – гармоническое продолжение
 *   (cos ψ, sin ψ) в области своей черты. Линии ψ гладкие и почти ортогональны кольцам (у `weave5`
 *   спицы шли углом вокруг оси лица – ромбы на скулах). Между областями черт – шов (стык петель).
 * - G = |∇ψ| / ρ – сколько радиан метки на единицу D; шейдер берёт по нему число спиц (степень
 *   двойки, как полюса ретопологии: где спицы расходятся – между старыми плавно проявляются новые).
 * - зазор – насколько вершина ближе к своей черте, чем к соседней (со знаком по паре черт): по нему
 *   шейдер рисует шов между областями ровной нитью без спиц.
 *
 * За маской лица (D > 0.15…0.2) шейдер переходит на клетку «Плетения 6»: на затылке и шее
 * гармоническая метка сходится в полюса.
 *
 * Считается один раз на геометрию и кешируется в ней самой: ≈ 50 тыс. вершин, четыре решения
 * сопряжёнными градиентами – ≈ 2 с в Node на этой машине (в браузере – того же порядка, главный поток).
 */
export const WEAVE_LINES_ATTR = 'fspLine';
export const WEAVE_LINES_FEAT_ATTR = 'fspLineF';

/** Аналитическая зона у черты (в единицах модели); у рта шире нельзя – зона цепляет низ носа. */
const ZONE = [0.03, 0.03, 0.03];


/** Плотность клетки: 1.5 на маске лица (овал спереди), 1 на черепе и шее. */
export function faceDensity(x: number, y: number, z: number): number {
  const r = Math.hypot(x / 0.2, (y - 0.5) / 0.29);
  const oval = 1 - smooth(0.85, 1.25, r);
  return 1 + 0.5 * oval * smooth(0.12, 0.26, z);
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Отступ D, при котором точка (x, y) лежит на эллипсе (a + D, b + D); 0 внутри (a, b). */
export function ovalOffset(x: number, y: number, a: number, b: number): number {
  if ((x / a) ** 2 + (y / b) ** 2 <= 1) return 0;
  let lo = 0;
  let hi = Math.hypot(x, y);
  for (let i = 0; i < 30; i++) {
    const d = (lo + hi) / 2;
    if ((x / (a + d)) ** 2 + (y / (b + d)) ** 2 > 1) lo = d;
    else hi = d;
  }
  return (lo + hi) / 2;
}

/** Параметр t эллипса → доля длины дуги × 2π (спицы на контуре черты – через равные отрезки). */
function arcTable(a: number, b: number): (t: number) => number {
  const N = 512;
  const cum = new Float64Array(N + 1);
  for (let i = 1; i <= N; i++) {
    const t0 = ((i - 1) / N) * 2 * Math.PI;
    const t1 = (i / N) * 2 * Math.PI;
    cum[i] = cum[i - 1]! + Math.hypot(a * (Math.cos(t1) - Math.cos(t0)), b * (Math.sin(t1) - Math.sin(t0)));
  }
  const total = cum[N]!;
  return (t) => {
    const u = ((((t / (2 * Math.PI)) % 1) + 1) % 1) * N;
    const i = Math.min(N - 1, Math.floor(u));
    return ((cum[i]! + (cum[i + 1]! - cum[i]!) * (u - i)) / total) * 2 * Math.PI;
  };
}

/** Добавляет `fspLine`/`fspLineF` в геометрию (если их ещё нет). false – сетка без индекса. */
export function addWeaveLines(g: BufferGeometry): boolean {
  if (g.getAttribute(WEAVE_LINES_ATTR)) return true;
  const normal = g.getAttribute('normal');
  if (!g.getAttribute('position') || !g.getIndex() || !normal) return false;
  const n = g.getAttribute('position').count;
  const { node, nodePos, m, skip, deg, adj } = weldGraph(g);
  const P = (k: number, c: number) => nodePos[k * 3 + c]!;
  const nz = new Float32Array(m);
  for (let i = 0; i < n; i++) nz[node[i]!] = normal.getZ(i);
  const rho = new Float64Array(m);
  for (let k = 0; k < m; k++) rho[k] = faceDensity(P(k, 0), P(k, 1), P(k, 2));
  const arcs = FEATURES.map((f) => arcTable(f.ab[0], f.ab[1]));

  // источники: внутри черты D = 0, в зоне у черты – аналитический овал; метка ψ – по параметру эллипса
  const init = new Float64Array(m).fill(NaN);
  const feat = new Int8Array(m).fill(-1);
  const cs = new Float64Array(m * 2);
  const dist = new Float64Array(m).fill(Infinity);
  const heap = new Heap(dist);
  for (let k = 0; k < m; k++) {
    if (skip[k]) continue;
    for (let f = 0; f < FEATURES.length; f++) {
      const { c, ab } = FEATURES[f]!;
      if (P(k, 2) < c[2] - (f < 2 ? 0.03 : 0.06)) continue;
      const x = P(k, 0) - c[0];
      const y = P(k, 1) - c[1];
      const d = ovalOffset(x, y, ab[0], ab[1]);
      const inside = d === 0 && P(k, 2) >= c[2];
      if (!inside && (d > ZONE[f]! || nz[k]! < 0.3)) continue;
      const v = d * rho[k]!;
      if (v >= dist[k]!) continue;
      init[k] = v;
      dist[k] = v;
      feat[k] = f;
      const psi = arcs[f]!(Math.atan2(y / (ab[1] + d), x / (ab[0] + d)));
      cs[k * 2] = Math.cos(psi);
      cs[k * 2 + 1] = Math.sin(psi);
    }
    if (feat[k]! >= 0) heap.push(k);
  }
  const fixed = (k: number) => !Number.isNaN(init[k]!);

  // ближайшая черта (для валика века в шейдере) и начальное приближение – Дейкстра по рёбрам в метрике ρ
  const done = new Uint8Array(m);
  while (heap.size) {
    const a = heap.pop();
    if (done[a]) continue;
    done[a] = 1;
    for (let j = deg[a]!; j < deg[a + 1]!; j++) {
      const b = adj[j]!;
      if (done[b] || fixed(b)) continue;
      const len = Math.hypot(P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2));
      const d = dist[a]! + len * 0.5 * (rho[a]! + rho[b]!);
      if (d < dist[b]!) {
        dist[b] = d;
        feat[b] = feat[a]!;
        cs[b * 2] = cs[a * 2]!;
        cs[b * 2 + 1] = cs[a * 2 + 1]!;
        heap.push(b);
      }
    }
  }
  const guess = Float64Array.from(dist, (x) => (Number.isFinite(x) ? x : 0));

  // зазор до соседней области: (D до второй ближайшей черты) − (D до своей), 0 на стыке областей; по нему
  // шейдер рисует шов ровной линией, а не лесенкой треугольников. Дейкстра от каждой черты отдельно
  const second = new Float64Array(m).fill(Infinity);
  const secondF = new Int8Array(m).fill(-1);
  for (let f = 0; f < FEATURES.length; f++) {
    const df = new Float64Array(m).fill(Infinity);
    const hf = new Heap(df);
    for (let k = 0; k < m; k++) {
      if (!skip[k] && fixed(k) && feat[k] === f) {
        df[k] = init[k]!;
        hf.push(k);
      }
    }
    const seen = new Uint8Array(m);
    while (hf.size) {
      const a = hf.pop();
      if (seen[a]) continue;
      seen[a] = 1;
      for (let j = deg[a]!; j < deg[a + 1]!; j++) {
        const b = adj[j]!;
        if (seen[b]) continue;
        const len = Math.hypot(P(b, 0) - P(a, 0), P(b, 1) - P(a, 1), P(b, 2) - P(a, 2));
        const d = df[a]! + len * 0.5 * (rho[a]! + rho[b]!);
        if (d < df[b]!) {
          df[b] = d;
          hf.push(b);
        }
      }
    }
    for (let k = 0; k < m; k++) {
      if (f === feat[k] || df[k]! >= second[k]!) continue;
      second[k] = df[k]!;
      secondF[k] = f;
    }
  }
  // со знаком (по паре черт): через шов зазор меняется линейно, и сглаживание не поднимает его ноль
  let gap = Float64Array.from(second, (x, k) =>
    Number.isFinite(x) ? Math.min(x - guess[k]!, 1) * (feat[k]! < secondF[k]! ? 1 : -1) : 1,
  );
  for (let it = 0; it < 10; it++) {
    const g1 = Float64Array.from(gap);
    for (let a = 0; a < m; a++) {
      if (skip[a]) continue;
      let q = gap[a]!;
      for (let j = deg[a]!; j < deg[a + 1]!; j++) q += gap[adj[j]!]!;
      g1[a] = q / (deg[a + 1]! - deg[a]! + 1);
    }
    gap = g1;
  }

  const lap = cotanLaplacian(g, node, m, skip);

  // кольца – расстояние методом тепла (Crane et al. 2013): короткая диффузия от черт, единичное поле
  // против её градиента (× ρ), затем Пуассон с D = овал на источниках. Расстояние Дейкстры по рёбрам
  // зубчатое, и кольца на черепе шли «волной»
  const heat = solve(lap, (k) => (fixed(k) ? 1 : NaN), null, new Float64Array(m), lap.h2 * 4, 1e-5);
  const div = new Float64Array(m);
  forTriangles(g, node, skip, (ids, v) => {
    // градиент u в треугольнике: Σ u_i (N × e_i) / 2A, e_i – противолежащее ребро
    const N = cross(sub(v[1]!, v[0]!), sub(v[2]!, v[0]!));
    const A2 = Math.hypot(N[0]!, N[1]!, N[2]!);
    if (A2 < 1e-14) return;
    const nn = N.map((q) => q / A2);
    const grad = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const e = sub(v[(i + 2) % 3]!, v[(i + 1) % 3]!);
      const c = cross(nn, e);
      for (let q = 0; q < 3; q++) grad[q]! += (heat[ids[i]!]! * c[q]!) / A2;
    }
    const gl = Math.hypot(grad[0]!, grad[1]!, grad[2]!);
    if (gl < 1e-30) return;
    const r = (rho[ids[0]!]! + rho[ids[1]!]! + rho[ids[2]!]!) / 3;
    const X = grad.map((q) => (-q / gl) * r);
    // интегральная дивергенция в вершине i: ½ Σ cot θ · (e · X) по двум рёбрам из i
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      const k = (i + 2) % 3;
      const e1 = sub(v[j]!, v[i]!);
      const e2 = sub(v[k]!, v[i]!);
      div[ids[i]!]! += 0.5 * (cotAt(v, k) * dot(e1, X) + cotAt(v, j) * dot(e2, X));
    }
  });
  // L·φ = −div (L = diag − W положительно полуопределён), φ = овал на источниках
  const D = solve(lap, (k) => (fixed(k) ? init[k]! : NaN), div.map((q) => -q), guess, 0, 1e-4);

  // спицы – гармоническое продолжение метки в области своей черты (ближайшей по D): cos ψ и sin ψ решают
  // уравнение Лапласа с условием Дирихле на овале черты; на границе областей рёбра разрезаны (Нейман), там
  // шов – как стык петель в ретопологии. Перенос метки вдоль градиента расстояния давал веера от уголков
  // черт и «ударные» швы («потрескавшаяся глина»), а общее поле без разрезов – полюса со «змейкой» между
  // глазом и ртом (метки соседних черт смотрят навстречу)
  const lapCut = cutLaplacian(lap, feat);
  // начальное приближение – метка ближайшего источника (Дейкстра), сходится в разы быстрее нуля
  const cosH = solve(lapCut, (k) => (fixed(k) ? cs[k * 2]! : NaN), null, Float64Array.from({ length: m }, (_, k) => cs[k * 2]!), 0, 1e-4);
  const sinH = solve(lapCut, (k) => (fixed(k) ? cs[k * 2 + 1]! : NaN), null, Float64Array.from({ length: m }, (_, k) => cs[k * 2 + 1]!), 0, 1e-4);
  for (let k = 0; k < m; k++) {
    if (skip[k] || fixed(k)) continue;
    const l = Math.hypot(cosH[k]!, sinH[k]!) || 1;
    cs[k * 2] = cosH[k]! / l;
    cs[k * 2 + 1] = sinH[k]! / l;
  }

  // G = |∇ψ| / ρ: градиент метки по треугольникам (метрика треугольника), к вершинам – с весом площади,
  // усреднение в логарифме
  const G = new Float64Array(m);
  const W = new Float64Array(m);
  const ang = (k: number) => Math.atan2(cs[k * 2 + 1]!, cs[k * 2]!);
  const wrap = (x: number) => x - 2 * Math.PI * Math.round(x / (2 * Math.PI));
  forTriangles(g, node, skip, (ids, v) => {
    const [a, b, c] = ids as [number, number, number];
    if (feat[a] !== feat[b] || feat[a] !== feat[c]) return;
    const db = wrap(ang(b) - ang(a));
    const dc = wrap(ang(c) - ang(a));
    const e1 = sub(v[1]!, v[0]!);
    const e2 = sub(v[2]!, v[0]!);
    const g11 = dot(e1, e1);
    const g22 = dot(e2, e2);
    const g12 = dot(e1, e2);
    const det = g11 * g22 - g12 * g12;
    if (det <= 1e-18) return;
    const grad2 = (db * db * g22 - 2 * db * dc * g12 + dc * dc * g11) / det;
    const area = Math.sqrt(det) / 2;
    const r = (rho[a]! + rho[b]! + rho[c]!) / 3;
    const val = Math.log(Math.max(Math.sqrt(Math.max(grad2, 0)) / r, 1e-3));
    for (const k of ids) {
      G[k]! += val * area;
      W[k]! += area;
    }
  });
  let LG = Float64Array.from(G, (q, k) => (W[k]! > 0 ? q / W[k]! : NaN));
  // сглаживание: число спиц меняется ступенями, рябь G не должна давать «лохмотья»
  for (let it = 0; it < 12; it++) {
    const L1 = Float64Array.from(LG);
    for (let a = 0; a < m; a++) {
      if (skip[a]) continue;
      let q = 0;
      let c = 0;
      for (let j = deg[a]! - 1; j < deg[a + 1]!; j++) {
        const u = j < deg[a]! ? a : adj[j]!;
        if (Number.isNaN(LG[u]!) || feat[u] !== feat[a]) continue;
        q += LG[u]!;
        c++;
      }
      L1[a] = c ? q / c : NaN;
    }
    LG = L1;
  }

  const out = new Float32Array(n * 4);
  const outF = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const k = node[i]!;
    out[i * 4] = Math.max(0, D[k]!);
    out[i * 4 + 1] = cs[k * 2]!;
    out[i * 4 + 2] = cs[k * 2 + 1]!;
    out[i * 4 + 3] = Number.isNaN(LG[k]!) ? 1 : Math.exp(LG[k]!);
    outF[i * 2] = Math.max(0, feat[k]!);
    outF[i * 2 + 1] = gap[k]!;
  }
  g.setAttribute(WEAVE_LINES_ATTR, new BufferAttribute(out, 4));
  g.setAttribute(WEAVE_LINES_FEAT_ATTR, new BufferAttribute(outF, 2));
  return true;
}

type V3 = number[];
const sub = (a: V3, b: V3): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
const dot = (a: V3, b: V3) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const cross = (a: V3, b: V3): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
/** Котангенс угла треугольника v при вершине i. */
function cotAt(v: V3[], i: number): number {
  const e1 = sub(v[(i + 1) % 3]!, v[i]!);
  const e2 = sub(v[(i + 2) % 3]!, v[i]!);
  const c = cross(e1, e2);
  return dot(e1, e2) / Math.max(Math.hypot(c[0]!, c[1]!, c[2]!), 1e-12);
}

/** Обход треугольников по сваренным узлам (без вырожденных и частей рта). */
function forTriangles(g: BufferGeometry, node: Int32Array, skip: Uint8Array, fn: (ids: number[], v: V3[]) => void) {
  const pos = g.getAttribute('position');
  const idx = g.getIndex()!.array;
  for (let t = 0; t < idx.length; t += 3) {
    const ids = [node[idx[t]!]!, node[idx[t + 1]!]!, node[idx[t + 2]!]!];
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2] || skip[ids[0]!] || skip[ids[1]!] || skip[ids[2]!]) continue;
    fn(
      ids,
      [0, 1, 2].map((i) => [pos.getX(idx[t + i]!), pos.getY(idx[t + i]!), pos.getZ(idx[t + i]!)]),
    );
  }
}

interface Laplacian {
  m: number;
  cnt: Int32Array;
  col: Int32Array;
  val: Float64Array;
  diag: Float64Array;
  mass: Float64Array;
  /** Средний квадрат длины ребра – масштаб времени диффузии. */
  h2: number;
}

/** Котангенсный Лапласиан (CSR весов W, диагональ Σ W) и сосредоточенная масса (площадь / 3). */
function cotanLaplacian(g: BufferGeometry, node: Int32Array, m: number, skip: Uint8Array): Laplacian {
  const Wm = new Map<number, number>();
  const mass = new Float64Array(m);
  let h2 = 0;
  let ne = 0;
  forTriangles(g, node, skip, (ids, v) => {
    const c = cross(sub(v[1]!, v[0]!), sub(v[2]!, v[0]!));
    const area = Math.hypot(c[0]!, c[1]!, c[2]!) / 2;
    for (let i = 0; i < 3; i++) {
      mass[ids[i]!]! += area / 3;
      const a = ids[(i + 1) % 3]!;
      const b = ids[(i + 2) % 3]!;
      const key = a < b ? a * m + b : b * m + a;
      Wm.set(key, (Wm.get(key) ?? 0) + Math.max(0.5 * cotAt(v, i), 1e-4));
      const e = sub(v[(i + 1) % 3]!, v[(i + 2) % 3]!);
      h2 += dot(e, e);
      ne++;
    }
  });
  const cnt = new Int32Array(m + 1);
  for (const key of Wm.keys()) {
    cnt[Math.floor(key / m) + 1]!++;
    cnt[(key % m) + 1]!++;
  }
  for (let i = 0; i < m; i++) cnt[i + 1]! += cnt[i]!;
  const col = new Int32Array(cnt[m]!);
  const val = new Float64Array(cnt[m]!);
  const fill = cnt.slice(0, m);
  const diag = new Float64Array(m);
  for (const [key, w] of Wm) {
    const a = Math.floor(key / m);
    const b = key % m;
    col[fill[a]!] = b;
    val[fill[a]!++] = w;
    col[fill[b]!] = a;
    val[fill[b]!++] = w;
    diag[a]! += w;
    diag[b]! += w;
  }
  return { m, cnt, col, val, diag, mass, h2: ne ? h2 / ne : 0 };
}

/** Лапласиан с разрезанными рёбрами между областями разных черт (`region`). */
function cutLaplacian(L: Laplacian, region: Int8Array): Laplacian {
  const val = Float64Array.from(L.val);
  const diag = new Float64Array(L.m);
  for (let a = 0; a < L.m; a++) {
    for (let j = L.cnt[a]!; j < L.cnt[a + 1]!; j++) {
      if (region[L.col[j]!] !== region[a]) val[j] = 0;
      diag[a]! += val[j]!;
    }
  }
  return { ...L, val, diag };
}

/**
 * (t·L + M)·x = rhs, если t > 0 (тепло), иначе L·x = rhs; L = diag − W. Условия Дирихле `bc(k)` (число –
 * значение, NaN – свободный узел; на остальной границе – естественное условие Неймана). Сопряжённые
 * градиенты с диагональным предобуславливателем до относительной невязки `tol`, `guess` – начальное
 * приближение свободных узлов.
 */
function solve(L: Laplacian, bc: (k: number) => number, rhs: Float64Array | null, guess: Float64Array, t: number, tol: number): Float64Array {
  const { m, cnt, col, val, diag, mass } = L;
  const s = t > 0 ? t : 1;
  const dg = Float64Array.from(diag, (d, k) => s * d + (t > 0 ? mass[k]! : 0));
  // свободные узлы и матрица только по ним (фиксированные соседи уходят в правую часть)
  const x = new Float64Array(m);
  const isFree = new Uint8Array(m);
  for (let k = 0; k < m; k++) {
    const v = diag[k] === 0 ? 0 : bc(k);
    if (Number.isNaN(v)) {
      isFree[k] = 1;
      x[k] = guess[k]!;
    } else x[k] = v;
  }
  const r = new Float64Array(m);
  const fc = new Int32Array(m + 1);
  for (let a = 0; a < m; a++) {
    fc[a + 1] = fc[a]!;
    if (!isFree[a]) continue;
    let q = (rhs ? rhs[a]! : 0) - dg[a]! * x[a]!;
    for (let j = cnt[a]!; j < cnt[a + 1]!; j++) {
      q += s * val[j]! * x[col[j]!]!;
      if (isFree[col[j]!]) fc[a + 1]!++;
    }
    r[a] = q;
  }
  const fcol = new Int32Array(fc[m]!);
  const fval = new Float64Array(fc[m]!);
  for (let a = 0, o = 0; a < m; a++) {
    if (!isFree[a]) continue;
    for (let j = cnt[a]!; j < cnt[a + 1]!; j++) {
      if (!isFree[col[j]!]) continue;
      fcol[o] = col[j]!;
      fval[o++] = s * val[j]!;
    }
  }
  const inv = Float64Array.from(dg, (d, k) => (isFree[k] && d > 0 ? 1 / d : 0));
  const z = Float64Array.from(r, (ri, a) => ri * inv[a]!);
  const p = Float64Array.from(z);
  const Ap = new Float64Array(m);
  let rz = 0;
  for (let a = 0; a < m; a++) rz += r[a]! * z[a]!;
  const r0 = Math.sqrt(r.reduce((q, v) => q + v * v, 0)) || 1;
  for (let it = 0; it < 3000; it++) {
    let pAp = 0;
    for (let a = 0; a < m; a++) {
      if (!isFree[a]) continue;
      let q = dg[a]! * p[a]!;
      for (let j = fc[a]!; j < fc[a + 1]!; j++) q -= fval[j]! * p[fcol[j]!]!;
      Ap[a] = q;
      pAp += p[a]! * q;
    }
    if (pAp <= 0) break;
    const alpha = rz / pAp;
    let rr = 0;
    let rz1 = 0;
    for (let a = 0; a < m; a++) {
      x[a]! += alpha * p[a]!;
      const ra = r[a]! - alpha * Ap[a]!;
      r[a] = ra;
      rr += ra * ra;
      z[a] = ra * inv[a]!;
      rz1 += ra * z[a]!;
    }
    if (Math.sqrt(rr) < tol * r0) break;
    const beta = rz1 / rz;
    rz = rz1;
    for (let a = 0; a < m; a++) p[a] = z[a]! + beta * p[a]!;
  }
  return x;
}

/** Варьинги поля линий – в шапку фрагментного шейдера (внутри блока FSP_WEAVE_NEW из weave-retopo). */
export const WEAVE_LINES_GLSL_HEAD = `
  #ifdef FSP_WEAVE9
  varying vec4 vFspLine;
  varying vec2 vFspLineF;
  #endif
`;

/**
 * Блок цвета «Плетения 9»: задаёт \`wire\` (покрытие нитью и наклон нормали) для общего хвоста
 * weave-retopo – материал ячеек и проволоки ровно как у «Плетения 6».
 */
export const WEAVE_LINES_GLSL_COLOR = `
  #ifdef FSP_WEAVE9
  {
    float D = vFspLine.x;
    float feat = floor(vFspLineF.x + 0.5);
    // ψ ∈ [−½, ½) оборота; число спиц на оборот – 4·2^ℓ по G. ℓ дробный: между соседними степенями
    // двойки новые спицы проявляются плавно (старые совпадают с каждой второй новой), без рваных швов
    float psi = atan(vFspLine.z, vFspLine.y) / 6.2831853;
    float G = max(vFspLine.w, 1e-3);
    float lv = clamp(log2(6.2831853 * k / (G * 4.0)), 2.0, 10.0);
    float L0 = floor(lv);
    float fade = smoothstep(0.25, 0.75, lv - L0);
    float pickB = step(fwidth(fract(psi + 0.5)), fwidth(psi));
    vec3 wl[2];
    for (int i = 0; i < 2; i++) {
      float Nq = 4.0 * exp2(L0 + float(i));
      vec2 cell = vec2(D * k, psi * Nq);
      vec2 cellB = vec2(cell.x, fract(psi + 0.5) * Nq);
      wl[i] = mix(fwWire(cell, 0.18), fwWire(cellB, 0.18), pickB);
    }
    wire = mix(wl[0], wl[1], fade);
    // шов между областями черт: в треугольниках на стыке метки соседних черт перемешаны. В полосе у шва
    // (по зазору, ≈ 1,5 ребра сетки) спиц нет – только кольца и одна нить вдоль самого шва, как стык петель
    float gp = abs(vFspLineF.y);
    float strip = 1.0 - smoothstep(0.02, 0.03, gp);
    vec3 seamW = fwWire(vec2(D * k, clamp(gp * k * 0.5, -0.49, 0.49)), 0.18);
    wire = mix(wire, seamW, strip);
    // за маской лица – клетка «Плетения 6» (обтекание по трём проекциям): на затылке и шее гармоническая
    // метка сходится в полюса, спицы там слишком редкие/частые. Переход – по кольцам D, ≈ 3 клетки
    {
      vec3 n6 = normalize(vModelNormal);
      vec3 w6 = pow(abs(n6), vec3(4.0));
      w6 /= (w6.x + w6.y + w6.z);
      vec2 f6 = fwFaceFlow(p.xy, 1.0, 0.5);
      vec2 s6 = p.zy + fwFlowR(p.zy, vec2(0.035, 0.535), vec2(0.06, 0.1), 1.0) * smoothstep(0.18, 0.26, abs(p.x));
      vec3 wire6 = fwWire(s6 * k, 0.18) * w6.x + fwWire(p.xz * k, 0.18) * w6.y + fwWire(f6 * k, 0.18) * w6.z;
      float face = (1.0 - smoothstep(0.15, 0.2, D)) * (1.0 - smoothstep(7.5, 8.5, lv));
      wire = mix(wire6, wire, face);
    }
    // гладкие черты: внутри миндаля глаза и на кайме губ (D = 0) – металл без клетки
    float dk = D * k;
    vec3 smoothMetal = vec3(1.0, 0.0, 0.0);
    if (feat < 1.5) {
      // валик века: полоса шириной ≈ 1.3 клетки вокруг глаза, гладкая, с выпуклым профилем
      float lid = 1.0 - smoothstep(1.1, 1.4, dk);
      float s = clamp(dk / 1.25, 0.0, 1.0);
      vec2 g = vec2(dFdx(dk), dFdy(dk));
      vec3 ridge = vec3(1.0, 0.35 * 3.1415927 / 1.25 * cos(3.1415927 * s) * g * step(0.001, D));
      wire = mix(wire, ridge, lid);
    } else {
      wire = mix(wire, smoothMetal, 1.0 - smoothstep(0.0, 0.35, dk));
    }
    // ухо почти сплошное: клетка едва проступает
    vec3 ap = vModelPos;
    float ear = smoothstep(0.295, 0.325, abs(ap.x)) * (1.0 - smoothstep(0.85, 1.05, length((ap.zy - vec2(0.02, 0.545)) / vec2(0.13, 0.11))));
    wire = mix(wire, smoothMetal, ear * 0.85);
  }
  #endif
`;

/** Атрибуты поля линий в вершинный шейдер (только `weave9`). */
export function weaveLinesVertex(src: string): string {
  return src.replace(
    'void main() {',
    'attribute vec4 fspLine;\nattribute vec2 fspLineF;\nvarying vec4 vFspLine;\nvarying vec2 vFspLineF;\nvoid main() {\n  vFspLine = fspLine;\n  vFspLineF = fspLineF;',
  );
}

