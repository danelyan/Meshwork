import { BufferAttribute, BufferGeometry, CylinderGeometry, Float32BufferAttribute, SphereGeometry } from 'three';

/**
 * Процедурная голова компаньона: сфера, деформированная в голову (череп, сужение к подбородку,
 * нос, глазницы, губы, уши), с морфом `jawOpen` (челюсть вниз + впадина рта). Своя геометрия, а
 * не `facecap.glb`: у модели Face Cap нет подтверждённой лицензии (docs/research/19), а сетка
 * сферы сама даёт квадратную «ткань» как на референсе брендбука. Лицо смотрит в +Z.
 */
export const JAW_OPEN = 'jawOpen';

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const gauss = (d: number, s: number) => Math.exp(-(d * d) / (2 * s * s));

/** Радиальная добавка рельефа лица в точке единичной сферы (x, y, z), лицо – +Z. */
function relief(x: number, y: number, z: number): number {
  const front = smooth(0.35, 0.9, z);
  let d = 0;
  // нос: спинка от переносицы к кончику, кончик выступает сильнее
  const noseY = smooth(0.2, -0.12, y) * (y > -0.12 ? 1 : gauss(y + 0.12, 0.035));
  d += 0.32 * noseY * gauss(x, 0.06 + 0.035 * smooth(0.2, -0.12, y)) * front;
  // крылья носа
  for (const s of [-1, 1]) d += 0.05 * gauss(x - s * 0.09, 0.04) * gauss(y + 0.13, 0.035) * front;
  // глазницы и надбровье
  for (const s of [-1, 1]) {
    d -= 0.12 * gauss(x - s * 0.3, 0.1) * gauss(y - 0.13, 0.065) * front;
    d += 0.03 * gauss(x - s * 0.3, 0.06) * gauss(y - 0.12, 0.035) * front; // глазное яблоко
    d += 0.035 * gauss(x - s * 0.47, 0.11) * gauss(y + 0.06, 0.08) * front; // скулы
  }
  d += 0.035 * gauss(y - 0.27, 0.05) * smooth(0.55, 0.3, Math.abs(x)) * front;
  // губы и линия рта
  d += 0.045 * gauss(x, 0.15) * gauss(y + 0.41, 0.035) * front;
  d += 0.04 * gauss(x, 0.13) * gauss(y + 0.53, 0.04) * front;
  d -= 0.03 * gauss(x, 0.17) * gauss(y + 0.47, 0.014) * front;
  // подбородок
  d += 0.05 * gauss(x, 0.16) * gauss(y + 0.74, 0.07) * front;
  // уши: по бокам, чуть позади середины
  for (const s of [-1, 1]) d += 0.045 * gauss(x - s, 0.08) * gauss(y - 0.02, 0.15) * gauss(z + 0.05, 0.06);
  return d;
}

/** Единичная сфера → голова в координатах сцены (до морфа). */
function sculpt(x: number, y: number, z: number): [number, number, number] {
  const r = 1 + relief(x, y, z);
  let X = x * r * 0.76;
  let Y = y * r * 0.92;
  let Z = z * r * (z < 0 ? 0.95 : 0.86);
  // сужение к подбородку и нижней челюсти
  const low = smooth(0.15, -0.95, y);
  X *= 1 - 0.3 * low;
  if (z > 0) Z *= 1 - 0.12 * low;
  // лицо – плоскости, а не шар: бока лица отступают назад
  if (z > 0) Z *= 1 - 0.1 * smooth(0.3, 0.75, Math.abs(x)) * smooth(0.1, 0.6, z) * smooth(0.45, -0.1, y);
  // затылок чуть выше и объёмнее
  if (z < 0 && y > 0) Y *= 1 + 0.06 * -z;
  // лоб плосче спереди
  if (y > 0.3 && z > 0) Z *= 1 - 0.06 * smooth(0.3, 0.8, y);
  return [X, Y, Z];
}

/** Морф «рот открыт»: нижняя челюсть поворачивается вниз-назад вокруг оси ушей, рот проваливается внутрь. */
function jawOpen(p: [number, number, number], unit: [number, number, number]): [number, number, number] {
  const [x, y, z] = unit;
  const front = smooth(-0.2, 0.4, z);
  const jaw = smooth(-0.44, -0.56, y) * front;
  const X = p[0];
  let [, Y, Z] = p;
  if (jaw > 0) {
    const a = 0.26 * jaw;
    const py = -0.26;
    const pz = -0.12;
    const dy = Y - py;
    const dz = Z - pz;
    Y = py + dy * Math.cos(a) - dz * Math.sin(a);
    Z = pz + dy * Math.sin(a) + dz * Math.cos(a);
  }
  // полость рта: впадина по центру между губами
  const cavity = gauss(x, 0.14) * gauss(y + 0.5, 0.05) * smooth(0.5, 0.9, z);
  Z -= 0.14 * cavity;
  // верхняя губа слегка поднимается
  Y += 0.015 * gauss(x, 0.15) * gauss(y + 0.42, 0.04) * smooth(0.5, 0.9, z);
  return [X, Y, Z];
}

export interface HeadGeometries {
  head: BufferGeometry;
  neck: BufferGeometry;
}

/** Атрибут `gridUv` – копия uv для шейдера сетки (не зависит от того, включает ли three свой USE_UV). */
function withGridUv(g: BufferGeometry, scaleU = 1, scaleV = 1): BufferGeometry {
  const uv = g.getAttribute('uv') as BufferAttribute;
  const arr = new Float32Array(uv.count * 2);
  for (let i = 0; i < uv.count; i++) {
    arr[i * 2] = uv.getX(i) * scaleU;
    arr[i * 2 + 1] = uv.getY(i) * scaleV;
  }
  g.setAttribute('gridUv', new Float32BufferAttribute(arr, 2));
  return g;
}

export function buildHeadGeometry(widthSegments = 96, heightSegments = 72): HeadGeometries {
  const head = new SphereGeometry(1, widthSegments, heightSegments);
  head.rotateY(-Math.PI / 2); // шов сферы – на затылок
  const pos = head.getAttribute('position') as BufferAttribute;
  const base = new Float32Array(pos.count * 3);
  const open = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const unit: [number, number, number] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const p = sculpt(...unit);
    const q = jawOpen(p, unit);
    base.set(p, i * 3);
    open.set(q, i * 3);
  }
  head.setAttribute('position', new Float32BufferAttribute(base, 3));
  head.computeVertexNormals();

  // нормали открытого рта – чтобы впадина темнела при свете
  const morph = new BufferGeometry();
  morph.setIndex(head.getIndex());
  morph.setAttribute('position', new Float32BufferAttribute(open, 3));
  morph.computeVertexNormals();
  const openPos = new Float32BufferAttribute(open, 3);
  openPos.name = JAW_OPEN;
  const openNormal = morph.getAttribute('normal') as BufferAttribute;
  openNormal.name = JAW_OPEN;
  head.morphAttributes.position = [openPos];
  head.morphAttributes.normal = [openNormal];
  head.morphTargetsRelative = false;
  morph.dispose();
  withGridUv(head);

  const neck = new CylinderGeometry(0.34, 0.42, 1.1, 64, 12, true);
  neck.rotateY(Math.PI); // шов цилиндра – назад
  neck.translate(0, -1.02, -0.12);
  // клетка шеи примерно того же размера, что на голове (окружность шеи вдвое меньше)
  withGridUv(neck, 0.55, 0.36);
  return { head, neck };
}
