/**
 * «Плетение 5…8» – третья итерация по референсу брендбука (face1.png). Отличия референса от
 * `weave`…`weave4`, которые здесь закрываются:
 *  1) нить – толстая проволока (≈ 30 % клетки), между нитями тёмная матовая «дыра», а не светлый металл
 *     с волосяными линиями поверх: голова читается как сетка, а не как хром с нарисованной клеткой;
 *  2) блик живёт на каждой нити отдельно, основа его не ловит (roughness/metalness по маске нити);
 *  3) топология – как у ретопологии: петли вокруг глаз и рта, «спицы» к ним, швы-полюса, а не
 *     трипланарная смесь с размытыми зонами на висках;
 *  4) глазное яблоко гладкое, без клетки;
 *  5) плотность – ≈ 45 клеток на ширину черепа (как на референсе), на маленьком холсте нити сходятся
 *     в средний тон ткани (антимуар по покрытию), а не в чёрное или белое.
 *
 * Версии:
 * - `weave5` «Ретопология»: петли и спицы по полю `fspField` (геодезическое расстояние до черт и номер
 *   черты, см. weave-field.ts; спицы – лучи из центра черты, дальше вокруг оси лица), плоская сетка с
 *   тёмными ячейками, гладкие глаза и губы;
 * - `weave6` «Проволока»: обтекание `weave3`, но нить – цилиндр с наклоном нормали и своим бликом;
 * - `weave7` «Кубосфера»: равноугольная кубосфера из центра черепа с жёсткими швами (как патчи черепа на
 *   референсе), шея – цилиндр, лицо – с обтеканием черт;
 * - `weave8` «Двойная нить»: поле `weave5`, каждая 4-я нить – толстая проволока с бликом, между ними
 *   тонкие плоские нити ткани;
 * - `weave9` «Проволока на линиях ретопологии»: проволока и ячейки `weave6` на поле линий
 *   (weave-lines.ts): кольца по расстоянию до черт, спицы по его градиенту, лицо в 1,5 раза плотнее.
 *
 * Вставки – как у weave-versions.ts: шапка после `fspLine`, блок цвета после `#include <color_fragment>`;
 * плюс `weaveRetopoVertex` (атрибут поля в вершинный шейдер) и `weaveRetopoFragment` (roughness,
 * metalness и наклон нормали по нити) – отдельные вызовы в Head3D.surfaceMaterial.
 */
import type { HeadStyle } from './head-styles';
import { WEAVE_LINES_GLSL_COLOR, WEAVE_LINES_GLSL_HEAD, weaveLinesVertex } from './weave-lines';

/** Стили, которым нужен per-vertex атрибут `fspField` (Head3D добавляет его в геометрию). */
export const WEAVE_FIELD_STYLES: ReadonlySet<HeadStyle> = new Set<HeadStyle>(['weave5', 'weave8']);

export const WEAVE_RETOPO_GLSL_HEAD = `
  #if defined(FSP_WEAVE5) || defined(FSP_WEAVE6) || defined(FSP_WEAVE7) || defined(FSP_WEAVE8) || defined(FSP_WEAVE9)
  #define FSP_WEAVE_NEW
  #endif
  ${WEAVE_LINES_GLSL_HEAD}
  #if defined(FSP_WEAVE5) || defined(FSP_WEAVE8)
  varying vec2 vFspField;
  #endif
  #ifdef FSP_WEAVE_NEW
  // яркость основы в ячейке относительно нити: у 6 и 9 светлее (серые ячейки референса face1.png)
  // и материал ячейки: у 6 и 9 – тот же металл, что нить, только темнее и шероховатее, поэтому ячейка
  // везде темнее нити (матовая светлая ячейка в тени оказывалась светлее металлической нити)
  #if defined(FSP_WEAVE6) || defined(FSP_WEAVE9)
  #define FW_CELL 0.3
  #define FW_CELL_METAL -1.0
  #define FW_CELL_ROUGH 0.6
  #else
  #define FW_CELL 0.1
  #define FW_CELL_METAL 0.2
  #define FW_CELL_ROUGH 0.78
  #endif
  // маска нити (1 – проволока, 0 – ячейка) и наклон «высоты» нити в экранных пикселях (для нормали)
  float fwWireG = 1.0;
  vec2 fwBumpG = vec2(0.0);

  // проволока по двум семействам: x – покрытие нитью (с антиалиасингом и антимуаром), yz – dH/d(экран).
  // hw – полуширина нити в долях клетки; профиль – цилиндр, h = sqrt(1 − (t/hw)²)
  vec3 fwWire(vec2 cell, float hw) {
    vec2 dx = dFdx(cell);
    vec2 dy = dFdy(cell);
    vec2 fw = abs(dx) + abs(dy);
    vec2 t = fract(cell + 0.5) - 0.5;
    vec2 ad = abs(t);
    vec2 cov = 1.0 - smoothstep(hw - fw * 0.5, hw + fw * 0.5, ad);
    // клетка мельче ~3 px: нить и ячейка сливаются в средний тон по доле площади нити
    vec2 fade = smoothstep(vec2(0.22), vec2(0.45), fw);
    cov = mix(cov, vec2(2.0 * hw), fade);
    vec2 u = clamp(t / hw, -0.92, 0.92);
    vec2 h = sqrt(1.0 - u * u);
    vec2 dh = -u / (hw * h) * cov * (1.0 - fade);
    // на перекрестье верхней считается нить с большей высотой
    float ax = step(cov.y * h.y, cov.x * h.x);
    vec2 dHdc = vec2(dh.x * ax, dh.y * (1.0 - ax));
    return vec3(max(cov.x, cov.y), dot(dHdc, dx), dot(dHdc, dy));
  }

  // обтекание черты (как fwFlow у weave3): конформный диполь, погашенный за 4 радиусами
  vec2 fwFlowR(vec2 z, vec2 c, vec2 ab, float s) {
    vec2 q = (z - c) / ab;
    float r2 = dot(q, q);
    vec2 d = vec2(q.x, -q.y) / (r2 + 0.2) * ab;
    return d * s * (1.0 - smoothstep(4.0, 9.0, r2));
  }
  // s – сила обтекания (1 – сетка ложится по контуру), nose – доля для носа
  vec2 fwFaceFlow(vec2 xy, float s, float nose) {
    vec2 f = xy;
    f += fwFlowR(xy, vec2(-0.115, 0.632), vec2(0.075, 0.045), s);
    f += fwFlowR(xy, vec2(0.115, 0.632), vec2(0.075, 0.045), s);
    f += fwFlowR(xy, vec2(0.0, 0.432), vec2(0.085, 0.04), s);
    f += fwFlowR(xy, vec2(0.0, 0.53), vec2(0.04, 0.055), nose);
    return f;
  }

  // гладкие глазное яблоко и губы: 1 внутри миндаля глаза и контура губ (как на референсе – металл
  // без клетки; на губах клетка ещё и сминается морфами рта)
  float fwSmooth(vec3 p) {
    vec2 qa = (p.xy - vec2(-0.115, 0.632)) / vec2(0.05, 0.025);
    vec2 qb = (p.xy - vec2(0.115, 0.632)) / vec2(0.05, 0.025);
    float eye = (1.0 - smoothstep(0.8, 1.0, min(length(qa), length(qb)))) * smoothstep(0.25, 0.29, p.z);
    float lip = (1.0 - smoothstep(0.75, 1.0, length((p.xy - vec2(0.0, 0.432)) / vec2(0.068, 0.03)))) * smoothstep(0.33, 0.37, p.z);
    return max(eye, lip);
  }

  // равноугольная кубосфера из центра черепа: швы по диагоналям, как патчи на черепе референса.
  // s клеток на полпатча – целое, поэтому нити соседних патчей сходятся на шве. Низ (шея) – цилиндр:
  // долгота совпадает с горизонталью боковых патчей, высота продолжает их вертикаль от шва вниз.
  vec2 fwCube(vec3 p, float k) {
    vec3 d = p - vec3(0.0, 0.58, 0.03);
    vec3 a = abs(d);
    float s = floor(k * 0.36 * 0.7853982 + 0.5);
    float hr = max(a.x, a.z);
    vec2 uv = a.x >= a.z ? vec2(-d.z * sign(d.x), d.y) / max(a.x, 1e-4) : vec2(d.x * sign(d.z), d.y) / max(a.z, 1e-4);
    vec2 top = vec2(d.x, d.z) / max(a.y, 1e-4);
    vec2 e = atan(a.y > hr ? top : uv) * 1.2732395 * s;
    if (a.y > hr && d.y < 0.0) e = vec2(atan(d.x, d.z) * 1.2732395 * s, -s + (d.y + hr) * k);
    return e;
  }
  #endif
`;

export const WEAVE_RETOPO_GLSL_COLOR = `
  #ifdef FSP_WEAVE_NEW
  {
    vec3 p = vModelPos;
    vec3 base = diffuseColor.rgb;
    // ≈ 45 клеток на ширину черепа на крупном холсте (как на референсе), реже на маленьком
    float k = uGrid.x * 0.5;
    vec3 wire = vec3(0.0);
    float minor = 0.0;
    #if defined(FSP_WEAVE5) || defined(FSP_WEAVE8)
    {
      float d = vFspField.x;
      float feat = floor(vFspField.y + 0.5);
      // спицы у черты – лучи из её центра (перпендикуляр к петлям), за кольцом dS – угол вокруг оси
      // лица (Z через переносицу): на лбу вертикали, на щеках лучи от глаз, на шее вертикали. Переход –
      // ровно по нити кольца dS (целое кольцо), поэтому шов спрятан в проволоке. Дальше число спиц
      // удваивается (как полюса ретопологии)
      vec2 fc = feat < 0.5 ? vec2(-0.115, 0.632) : feat < 1.5 ? vec2(0.115, 0.632) : vec2(0.0, 0.432);
      vec2 fab = feat < 1.5 ? vec2(0.052, 0.026) : vec2(0.07, 0.02);
      vec2 fq = (p.xy - fc) / fab;
      float thF = atan(fq.y, fq.x) / 6.2831853;
      float NF = feat < 1.5 ? floor(0.25 * k / 4.0 + 0.5) * 4.0 : floor(0.33 * k / 4.0 + 0.5) * 4.0;
      float dS = floor(0.045 * k + 0.5) / k;
      float th = atan(p.y - 0.53, p.x) / 6.2831853;
      float d0 = 0.1;
      float N0 = floor(6.2831853 * d0 * k / 8.0 + 0.5) * 8.0;
      float N = N0 * exp2(floor(log2(1.0 + d / d0)));
      float near = step(d, dS);
      th = mix(th, thF, near);
      N = mix(N, NF, near);
      vec2 cell = vec2(d * k, th * N);
      // шов угла −½ → ½: производная берётся по ближнему из двух представлений
      vec2 cellB = vec2(cell.x, fract(th + 0.5) * N);
      vec3 wa = fwWire(cell, 0.13);
      vec3 wb = fwWire(cellB, 0.13);
      float pickB = step(fwidth(cellB.y), fwidth(cell.y));
      wire = mix(wa, wb, pickB);
      #ifdef FSP_WEAVE5
      wire.yz = vec2(0.0);
      #else
      // силовые нити – каждая 4-я, толстые с бликом; между ними тонкая плоская ткань
      vec3 big = mix(fwWire(cell / 4.0, 0.09), fwWire(cellB / 4.0, 0.09), pickB);
      minor = mix(fwWire(cell, 0.08).x, fwWire(cellB, 0.08).x, pickB);
      wire = vec3(max(big.x, minor * 0.45), big.yz * 0.25);
      #endif
      // глазное яблоко и губы внутри контура (d = 0) – гладкие
      wire = mix(wire, vec3(1.0, 0.0, 0.0), 1.0 - smoothstep(0.0, 0.006, d));
    }
    #endif
    #ifdef FSP_WEAVE6
    {
      vec3 n = normalize(vModelNormal);
      vec3 w = pow(abs(n), vec3(4.0));
      w /= (w.x + w.y + w.z);
      vec2 f = fwFaceFlow(p.xy, 1.0, 0.5);
      vec2 s = p.zy + fwFlowR(p.zy, vec2(0.035, 0.535), vec2(0.06, 0.1), 1.0) * smoothstep(0.18, 0.26, abs(p.x));
      wire = fwWire(s * k, 0.18) * w.x + fwWire(p.xz * k, 0.18) * w.y + fwWire(f * k, 0.18) * w.z;
      wire = mix(wire, vec3(1.0, 0.0, 0.0), fwSmooth(p));
    }
    #endif
    #ifdef FSP_WEAVE7
    {
      // лицо обтекает черты (смещение только спереди), затем – кубосфера
      vec3 q = p;
      q.xy = mix(p.xy, fwFaceFlow(p.xy, 0.45, 0.0), smoothstep(0.12, 0.25, p.z));
      wire = fwWire(fwCube(q, k), 0.15);
      wire.yz = vec2(0.0);
      wire = mix(wire, vec3(1.0, 0.0, 0.0), fwSmooth(p));
    }
    #endif
    ${WEAVE_LINES_GLSL_COLOR}
    // серебристая ткань: нить – металл основы, ячейка – тот же металл в тени (≈ 10 %) и матовая
    fwWireG = clamp(wire.x, 0.0, 1.0);
    fwBumpG = wire.yz * 0.7;
    // тон ячейки: у 6 и 9 – серый, как на референсе (решение владельца 10.10: ячейки не чёрные)
    diffuseColor.rgb = mix(base * FW_CELL, base, fwWireG);
  }
  #endif
`;

/** Атрибут поля в вершинный шейдер – стилям из WEAVE_FIELD_STYLES; `weave9` – поле линий (weave-lines.ts). */
export function weaveRetopoVertex(src: string, style: HeadStyle): string {
  if (style === 'weave9') return weaveLinesVertex(src);
  if (!WEAVE_FIELD_STYLES.has(style)) return src;
  return src.replace('void main() {', 'attribute vec2 fspField;\nvarying vec2 vFspField;\nvoid main() {\n  vFspField = fspField;');
}

/**
 * Материал по маске нити: ячейка матовая (у 5, 7, 8 почти не металл, у 6 и 9 – тёмный металл нити, см.
 * FW_CELL), нить – металл стиля; наклон нормали по профилю проволоки – формула perturbNormalArb из three (bumpmap_pars_fragment,
 * Mikkelsen), только dH/d(экран) считается аналитически по клетке, без текстуры.
 */
export function weaveRetopoFragment(src: string): string {
  return src
    .replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      #ifdef FSP_WEAVE_NEW
      roughnessFactor = mix(FW_CELL_ROUGH, roughnessFactor, fwWireG);
      #endif`,
    )
    .replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
      #ifdef FSP_WEAVE_NEW
      metalnessFactor = mix(FW_CELL_METAL < 0.0 ? metalnessFactor : FW_CELL_METAL, metalnessFactor, fwWireG);
      #endif`,
    )
    .replace(
      '#include <normal_fragment_maps>',
      `#include <normal_fragment_maps>
      #ifdef FSP_WEAVE_NEW
      {
        vec3 sx = normalize(dFdx(-vViewPosition));
        vec3 sy = normalize(dFdy(-vViewPosition));
        vec3 r1 = cross(sy, normal);
        vec3 r2 = cross(normal, sx);
        float det = dot(sx, r1) * faceDirection;
        vec3 grad = sign(det) * (fwBumpG.x * r1 + fwBumpG.y * r2);
        normal = normalize(abs(det) * normal - grad);
      }
      #endif`,
    );
}
