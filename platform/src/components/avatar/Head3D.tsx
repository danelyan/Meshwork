'use client';

import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Component, type ReactNode, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  type Group,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  ShaderMaterial,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { BRAND_GLSL_COLOR, BRAND_GLSL_HEAD } from './brand-weave';
import { buildHeadGeometry, JAW_OPEN } from './head-geometry';
import { DEFAULT_HEAD_STYLE, type HeadStyle } from './head-styles';
import { mouthOpen, smoothLevel } from './level';
import { CLOSED, type MouthShape, smoothShape } from './lipsync';
import type { VoiceStatus } from './voice';

/**
 * Серебристая голова-сетка компаньона на тёмном фоне (брендбук ФСП, docs/research/assets-19).
 * Основная голова — модель владельца `public/avatar/head.glb` (без текстур, см. README рядом):
 * металл MeshStandardMaterial + сетка «широта-долгота» в фрагментном шейдере по положению
 * вершины (как ткань на референсе), рот — процедурная челюсть в вершинном шейдере (поворот нижней
 * части лица вокруг оси ушей по громкости звука: у модели нет морфов). Пока файл грузится или если
 * он недоступен — процедурная голова из head-geometry с морфом `jawOpen`.
 * Грузится только через next/dynamic({ ssr: false }) — three.js не попадает в общий бандл.
 */
export interface Head3DProps {
  status: VoiceStatus;
  getLevel: () => number;
  /** Форма рта по висемам (voice.getMouth); без неё рот открывается по громкости. */
  getMouth?: () => MouthShape;
  reducedMotion?: boolean;
  /** Вид головы (см. head-styles.ts); по умолчанию — сетка-металл по референсу. */
  style?: HeadStyle;
}

/** Цвета бренда: акцент `--blue` из tokens.css и серебро референса. */
const ACCENT = '#402fff';
const SILVER = '#c4c9d2';

export const HEAD_URL = '/avatar/head.glb';

/**
 * Антропометрия модели в её координатах (высота 0…1 от основания шеи до макушки, лицо смотрит в +Z;
 * профиль снят скриптом при подготовке файла): линия рта, низ подбородка, ось челюсти на уровне ушей.
 */
export const HEAD_MODEL = {
  mouthY: 0.365,
  chinY: 0.27,
  jawPivotY: 0.55,
  /** Максимальный угол челюсти, рад (≈ 10°). */
  jawAngle: 0.17,
  /** Модель высотой 1 → сцена: как процедурная голова (≈ 2 единицы), центр на уровне глаз. */
  scale: 2.05,
  offsetY: -0.56,
} as const;

/** Плотность сетки — от высоты холста: в маленьком окне клетка крупнее, чтобы не рябило. */
const GRID = { width: 0.06, minU: 80, maxU: 230 };
export function gridDensity(heightPx: number): [number, number] {
  const u = Math.round(Math.min(GRID.maxU, Math.max(GRID.minU, heightPx / 3.0)));
  return [u, Math.round(u * 0.68)];
}

/** Для GLB сетка считается от долготы (вокруг оси Y) и высоты: долгот — как `u`, широт — по высоте модели. */
export function sphericalGrid([u]: [number, number]): [number, number] {
  return [u, Math.round(u * 0.42)];
}

/**
 * Вес процедурной челюсти для точки модели (та же формула, что в вершинном шейдере):
 * 1 — ниже линии рта и перед ушами, 0 — выше рта, на шее и на затылке.
 */
export function jawWeight(y: number, z: number, m = HEAD_MODEL): number {
  const step = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  const below = step(m.mouthY + 0.05, m.mouthY - 0.06, y);
  const aboveNeck = step(m.chinY - 0.04, m.chinY + 0.03, y);
  const front = step(-0.12, 0.1, z);
  return below * aboveNeck * front;
}

interface HeadUniforms {
  grid: { value: [number, number] };
  /** Раскрытие рта 0…1 (для процедурной головы и частиц). */
  jaw: { value: number };
  /** Рот: раскрытие, округление, растяжение, смыкание. */
  mouth: { value: [number, number, number, number] };
  /** Лицо: моргание 0…1, улыбка 0…1. */
  face: { value: [number, number, number, number] };
  time: { value: number };
  /** Половина высоты холста в px — для размера точек в режиме «частицы» (как `scale` у PointsMaterial). */
  pointScale: { value: number };
}

type Mode = 'attribute' | 'model';

/**
 * Процедурный рот без морфов: раскрытие в зоне губ (линия рта `uJawRegion.x`), а не поворот всей
 * челюсти. Нижняя губа опускается (вес максимален у линии рта, затухает к подбородку), верхняя
 * чуть поднимается, уголки сходятся к центру (округление), подбородок подхватывает лёгким поворотом
 * вокруг оси ушей. Всё — только спереди (z > 0) и в ширине рта (|x| < ~0.14 в координатах модели).
 */
const JAW_GLSL = `
  {
    float mouthY = uJawRegion.x;
    float width = 1.0 - smoothstep(0.09, 0.17, abs(position.x));
    float front = smoothstep(0.1, 0.3, position.z);
    float lips = width * front;
    float open = uMouth.x * lips;
    // зона губ: узкая полоса вокруг линии рта; уголки — её края по X
    float lipBand = smoothstep(mouthY - 0.05, mouthY - 0.015, position.y) * (1.0 - smoothstep(mouthY + 0.015, mouthY + 0.05, position.y));
    float corner = smoothstep(0.06, 0.12, abs(position.x)) * width * front * (1.0 - smoothstep(0.04, 0.07, abs(position.y - mouthY)));
    // нижняя губа и подбородок: сильнее у линии рта, к низу подбородка — слабее
    float lower = smoothstep(mouthY + 0.012, mouthY - 0.01, position.y) * smoothstep(uJawRegion.y - 0.05, mouthY - 0.03, position.y);
    // верхняя губа: узкая полоса над линией рта
    float upper = smoothstep(mouthY - 0.012, mouthY + 0.01, position.y) * (1.0 - smoothstep(mouthY + 0.02, mouthY + 0.06, position.y));
    transformed.y -= open * (0.042 * lower - 0.008 * upper);
    // растянутая полоса между губами — «полость рта», во фрагменте гасится до тёмного
    vMouth = open * smoothstep(mouthY + 0.015, mouthY + 0.004, position.y) * smoothstep(mouthY - 0.03, mouthY - 0.012, position.y);
    // округление (о/у): уголки к центру, губы вперёд; растяжение (э/и): уголки врозь и чуть вверх
    float roundW = uMouth.y * lips * lipBand;
    float wideW = uMouth.z * lips * lipBand;
    transformed.x *= 1.0 - roundW * 0.22 - open * 0.1 + wideW * 0.14;
    transformed.z += roundW * 0.02;
    transformed.y += wideW * 0.006 * corner;
    // смыкание (п/б/м, ф/в): губы прижаты к линии рта и чуть втянуты
    float pressW = uMouth.w * lips * lipBand;
    transformed.y -= (position.y - mouthY) * pressW * 0.45;
    transformed.z -= pressW * 0.012;
    // улыбка: уголки вверх
    transformed.y += uFace.y * 0.014 * corner;
    // подбородок слегка следует за нижней губой (поворот вокруг оси ушей)
    float chin = smoothstep(mouthY, uJawRegion.y - 0.02, position.y) * smoothstep(uJawRegion.y - 0.06, uJawRegion.y - 0.02, position.y);
    float a = uMouth.x * uJawRegion.w * 0.35 * chin * smoothstep(-0.12, 0.1, position.z);
    float c = cos(a), sn = sin(a);
    vec2 pv = vec2(transformed.y - uJawRegion.z, transformed.z);
    transformed.y = uJawRegion.z + pv.x * c - pv.y * sn;
    transformed.z = pv.x * sn + pv.y * c;
    // моргание: верхнее веко опускается к линии глаза (центры глаз — как в стиле «петли»)
    float eyeY = 0.63;
    float dEye = min(distance(position.xy, vec2(-0.115, eyeY)), distance(position.xy, vec2(0.115, eyeY)));
    float lid = (1.0 - smoothstep(0.035, 0.06, dEye)) * smoothstep(eyeY - 0.005, eyeY + 0.01, position.y) * smoothstep(0.05, 0.2, position.z);
    transformed.y -= uFace.x * lid * (position.y - eyeY) * 0.85;
  }`;

const JAW_REGION = [HEAD_MODEL.mouthY, HEAD_MODEL.chinY, HEAD_MODEL.jawPivotY, HEAD_MODEL.jawAngle];

/** Параметры MeshStandardMaterial по стилю (частицы — отдельный ShaderMaterial, см. particlesMaterial). */
const SURFACE: Record<Exclude<HeadStyle, 'particles'>, ConstructorParameters<typeof MeshStandardMaterial>[0]> = {
  metal: { color: new Color(SILVER), metalness: 0.55, roughness: 0.36 },
  grid: { color: new Color('#a4aab4'), metalness: 0.6, roughness: 0.34 },
  weave: { color: new Color('#a4aab4'), metalness: 0.6, roughness: 0.34 },
  brand: { color: new Color('#b4bac4'), metalness: 0.62, roughness: 0.32 },
  loops: { color: new Color('#a4aab4'), metalness: 0.6, roughness: 0.34 },
  chrome: { color: new Color('#8e939c'), metalness: 0.95, roughness: 0.24 },
  hologram: { color: new Color('#0b0b16'), metalness: 0, roughness: 1 },
  wire: { color: new Color('#6b717b'), metalness: 0.6, roughness: 0.35, wireframe: true },
};

/**
 * Поверхность головы: стандартный металл three + вставки в шейдер (сетка/блики/развёртка/свечение)
 * и процедурная челюсть. `uJaw`/`uTime` — общие объекты uniform'ов, их обновляет useFrame.
 */
function surfaceMaterial(u: HeadUniforms, mode: Mode, style: Exclude<HeadStyle, 'particles'>): MeshStandardMaterial {
  const m = new MeshStandardMaterial(SURFACE[style]);
  const model = mode === 'model';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = u.grid;
    shader.uniforms.uWidth = { value: GRID.width };
    shader.uniforms.uJaw = u.jaw;
    shader.uniforms.uMouth = u.mouth;
    shader.uniforms.uFace = u.face;
    shader.uniforms.uTime = u.time;
    shader.uniforms.uJawRegion = { value: JAW_REGION };
    shader.uniforms.uAccent = { value: new Color(ACCENT) };
    shader.uniforms.uSilver = { value: new Color(SILVER) };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#define STANDARD',
        `#define STANDARD
        ${model ? '#define FSP_MODEL' : 'attribute vec2 gridUv;'}
        varying vec2 vGridUv;
        varying vec3 vModelPos;
        varying vec3 vModelNormal;
        varying float vMouth;
        uniform float uJaw;
        uniform vec4 uMouth;
        uniform vec4 uFace;
        uniform vec4 uJawRegion;`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vModelPos = position;
        vModelNormal = normal;
        vMouth = 0.0;
        #ifdef FSP_MODEL
          vGridUv = vec2(atan(position.x, position.z) / 6.2831853 + 0.5, position.y);
        #else
          vGridUv = gridUv;
        #endif`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef FSP_MODEL
        ${JAW_GLSL}
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#define STANDARD',
        `#define STANDARD
        #define FSP_${style.toUpperCase()}
        varying vec2 vGridUv;
        varying vec3 vModelPos;
        varying vec3 vModelNormal;
        varying float vMouth;
        uniform vec2 uGrid;
        uniform float uWidth;
        uniform float uTime;
        uniform float uJaw;
        uniform vec4 uJawRegion;
        uniform vec3 uAccent;
        uniform vec3 uSilver;
        // линия сетки по дробной части координат клетки, толщина стабильна в пикселях (fwidth)
        float fspLine(vec2 cell) {
          vec2 fw = fwidth(cell);
          vec2 d = abs(fract(cell) - 0.5);
          vec2 a = smoothstep(0.5 - uWidth - fw, 0.5 - uWidth + fw * 0.5, d);
          return max(a.x, a.y) * (1.0 - smoothstep(0.3, 0.7, max(fw.x, fw.y)));
        }
        // тёмная основа + светлые нити, как на референсе брендбука (нити ловят свет как металл)
        const vec3 FSP_DARK = vec3(0.025, 0.028, 0.04);
        // кольца и спицы вокруг центра черты лица (глаз, рот): колец на единицу радиуса — как
        // меридианов на обхват головы (≈ 1.57 ед.), спиц столько, чтобы клетка была квадратной на r ≈ 0.06
        float fspLoop(vec2 q, float u) {
          float r = length(q);
          float ang = atan(q.y, q.x) / 6.2831853 + 0.5;
          return fspLine(vec2(ang * u * 0.24, r * u * 0.64));
        }
        // вес зоны черты лица: 1 у центра, 0 на радиусе R — по расстоянию во фронтальной плоскости XY
        // (глубина не учитывается: нос и скулы выступают, а нити должны огибать черту целиком)
        float fspZone(vec2 p, vec2 c, float R) {
          return smoothstep(R, R * 0.45, distance(p, c));
        }
        ${BRAND_GLSL_HEAD}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // полость открытого рта: темно, без нитей
        float mouthDark = 1.0 - clamp(vMouth * 2.5, 0.0, 0.92);
        #ifdef FSP_METAL
        {
          // первый вариант: светлый металл, тёмная клетка (крупнее, чем у нитей)
          float line = fspLine(vGridUv * uGrid * 0.55) ;
          diffuseColor.rgb *= mix(1.0, 0.22, min(1.0, line * 1.6));
        }
        #endif
        #ifdef FSP_GRID
        {
          // клетка «широта-долгота» по положению вершины
          float line = fspLine(vGridUv * uGrid);
          diffuseColor.rgb = mix(FSP_DARK, diffuseColor.rgb, line);
        }
        #endif
        #ifdef FSP_LOOPS
        {
          // как на оригинале: на черепе параллели и меридианы, у глаз и рта нити идут кольцами
          // и спицами (петли квад-топологии); центры черт сняты с модели (public/avatar/README.md)
          vec3 p = vModelPos;
          float u = uGrid.x;
          float base = fspLine(vGridUv * uGrid);
          vec2 eyeL = vec2(-0.115, 0.63), eyeR = vec2(0.115, 0.63), mouth = vec2(0.0, 0.37);
          float wl = fspZone(p.xy, eyeL, 0.16), wr = fspZone(p.xy, eyeR, 0.16), wm = fspZone(p.xy, mouth, 0.2);
          float wsum = wl + wr + wm;
          float loops = wsum > 0.001
            ? (wl * fspLoop(p.xy - eyeL, u) + wr * fspLoop(p.xy - eyeR, u) + wm * fspLoop(p.xy - mouth, u)) / wsum
            : 0.0;
          float line = mix(base, loops, clamp(wsum, 0.0, 1.0) * smoothstep(0.0, 0.2, p.z));
          diffuseColor.rgb = mix(FSP_DARK, diffuseColor.rgb, clamp(line, 0.0, 1.0));
        }
        #endif
        #ifdef FSP_WEAVE
        {
          // триплaнарная клетка: три проекции по осям, вес — по нормали, поэтому нити гнутся по рельефу
          vec3 n = normalize(vModelNormal);
          vec3 w = pow(abs(n), vec3(4.0));
          w /= (w.x + w.y + w.z);
          float k = uGrid.x * 0.5;
          float line = fspLine(vModelPos.yz * k) * w.x + fspLine(vModelPos.xz * k) * w.y + fspLine(vModelPos.xy * k) * w.z;
          diffuseColor.rgb = mix(FSP_DARK, diffuseColor.rgb, clamp(line, 0.0, 1.0));
        }
        #endif
        ${BRAND_GLSL_COLOR}
        diffuseColor.rgb *= mouthDark;
        #ifdef FSP_CHROME
        {
          // полосы отражений студийного света бегут по металлу (HeadLab «живой хром»)
          vec3 r = reflect(vec3(0.0, 0.0, -1.0), normalize(vNormal));
          float strip = pow(0.5 + 0.5 * sin(r.x * 8.0 + r.y * 3.0 + uTime * 0.5), 6.0);
          diffuseColor.rgb *= 1.0 + strip * 0.5;
        }
        #endif`,
      )
      // в полости рта нет ни металла, ни бликов окружения
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(1.0, roughnessFactor, mouthDark);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= mouthDark;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef FSP_HOLOGRAM
        {
          // строчная развёртка, краевое свечение и сканирующая полоса (HeadLab «голограмма»)
          float facing = abs(normalize(vNormal).z);
          float rim = pow(1.0 - facing, 2.5);
          float scanY = 0.5 + sin(uTime * 0.65) * 0.48;
          float scan = exp(-abs(vModelPos.y - scanY) * 65.0);
          float lines = pow(0.5 + 0.5 * sin(vModelPos.y * 750.0), 12.0);
          totalEmissiveRadiance += mix(uAccent, uSilver, 0.45) * (0.16 + facing * 0.2 + lines * 0.32 + rim * 1.5 + scan * 1.4);
        }
        #endif
        #ifdef FSP_WIRE
        {
          // сетка загорается от рта при речи и слабо дышит в покое (HeadLab «нейросетка»)
          float d = distance(vModelPos.xy, vec2(0.0, uJawRegion.x));
          float glow = exp(-d * 7.0) * (0.25 + uJaw * 1.2) + 0.04 * (0.5 + 0.5 * sin(uTime * 1.3));
          totalEmissiveRadiance += mix(vec3(0.0), uAccent + uSilver * 0.4, clamp(glow, 0.0, 1.0));
        }
        #endif`,
      );
  };
  m.customProgramCacheKey = () => `fsp-head-${style}-${mode}`;
  return m;
}

/** Облако точек по вершинам головы: на речи точки у рта разлетаются вдоль нормали (HeadLab «частицы»). */
function particlesMaterial(u: HeadUniforms, mode: Mode): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uJaw: u.jaw,
      uMouth: u.mouth,
      uFace: u.face,
      uTime: u.time,
      uPointScale: u.pointScale,
      uJawRegion: { value: JAW_REGION },
      uAccent: { value: new Color(ACCENT) },
      uSilver: { value: new Color(SILVER) },
    },
    defines: mode === 'model' ? { FSP_MODEL: '' } : {},
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    vertexShader: `
      uniform float uJaw;
      uniform vec4 uMouth;
      uniform vec4 uFace;
      uniform float uTime;
      uniform float uPointScale;
      uniform vec4 uJawRegion;
      varying float vFacing;
      varying float vSeed;
      varying float vMouth;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 transformed = position;
        float seed = hash(position);
        #ifdef FSP_MODEL
        ${JAW_GLSL}
        #endif
        // лёгкое мерцание облака + разлёт по нормали от громкости
        transformed += normal * (0.004 * sin(uTime * 1.5 + seed * 40.0) + uJaw * 0.03 * seed);
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vFacing = abs(normalize(normalMatrix * normal).z);
        vSeed = seed;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.028 + seed * 0.022) * uPointScale / -mv.z;
      }`,
    fragmentShader: `
      uniform vec3 uAccent;
      uniform vec3 uSilver;
      varying float vFacing;
      varying float vSeed;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        vec3 c = mix(uAccent, uSilver, clamp(vFacing * 0.85 + 0.2, 0.0, 1.0));
        gl_FragColor = vec4(c * (0.45 + vSeed * 0.3), smoothstep(0.5, 0.15, d) * 0.55);
      }`,
  });
}

function headMaterial(u: HeadUniforms, mode: Mode, style: HeadStyle): Material {
  return style === 'particles' ? particlesMaterial(u, mode) : surfaceMaterial(u, mode, style);
}

/** Общее для обеих голов: громкость → рот, покой/«думает»/говорит → движение группы, материал по стилю. */
function useHeadMotion(props: Head3DProps, mode: Mode) {
  const style = props.style ?? DEFAULT_HEAD_STYLE;
  const height = useThree((st) => st.size.height);
  const uniforms = useMemo<HeadUniforms>(
    () => ({ grid: { value: gridDensity(160) }, jaw: { value: 0 }, mouth: { value: [0, 0, 0, 0] }, face: { value: [0, 0, 0, 0] }, time: { value: 0 }, pointScale: { value: 80 } }),
    [],
  );
  useEffect(() => {
    const g = gridDensity(height);
    uniforms.grid.value = mode === 'model' ? sphericalGrid(g) : g;
    uniforms.pointScale.value = height / 2;
  }, [uniforms, height, mode]);
  const material = useMemo(() => headMaterial(uniforms, mode, style), [uniforms, mode, style]);
  useEffect(() => () => material.dispose(), [material]);
  const groupRef = useRef<Group>(null);
  const level = useRef(0);
  const shape = useRef<MouthShape>(CLOSED);
  const blink = useRef({ next: 2.5, start: -1 });
  const statusRef = useRef(props.status);
  statusRef.current = props.status;

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const s = statusRef.current;
    const step = Math.min(dt, 0.1);
    const speaking = s === 'speaking';
    const raw = speaking ? props.getLevel() : 0;
    level.current = smoothLevel(level.current, raw, step);
    // рот: висемы из спектра, если голос их даёт; иначе — только раскрытие по громкости
    const target = speaking && props.getMouth ? props.getMouth() : { ...CLOSED, open: mouthOpen(level.current) };
    shape.current = smoothShape(shape.current, target, step);
    const m = shape.current;
    uniforms.jaw.value = m.open;
    uniforms.mouth.value = [m.open, m.round, m.wide, m.press];
    // моргание каждые 2.5–6 с по 0.18 с; улыбка — когда говорит, в покое — лёгкая
    const b = blink.current;
    if (b.start < 0 && t >= b.next) b.start = t;
    let lid = 0;
    if (b.start >= 0) {
      const ph = (t - b.start) / 0.18;
      lid = ph < 0.5 ? ph * 2 : Math.max(0, 2 - ph * 2);
      if (ph >= 1) {
        b.start = -1;
        b.next = t + 2.5 + Math.random() * 3.5;
      }
    }
    const thinkingNow = s === 'thinking' || s === 'loading';
    const smile = props.reducedMotion ? 0 : speaking ? 0.35 : thinkingNow ? 0 : 0.15;
    uniforms.face.value = [props.reducedMotion ? 0 : lid, smile, 0, 0];
    uniforms.time.value = props.reducedMotion ? 0 : t;
    const g = groupRef.current;
    if (!g) return;
    const motion = props.reducedMotion ? 0 : 1;
    // покой: дыхание и лёгкое покачивание; «думает» — наклон и медленный поворот; говорит — кивки в такт
    const thinking = s === 'thinking' || s === 'loading' ? 1 : 0;
    g.rotation.y = -0.42 + motion * (Math.sin(t * 0.4) * 0.06 + thinking * Math.sin(t * 0.9) * 0.12);
    g.rotation.x = -0.1 + motion * (Math.sin(t * 0.55) * 0.02 + thinking * 0.08 + level.current * 0.2);
    g.rotation.z = motion * thinking * 0.06;
    g.position.y = motion * Math.sin(t * 1.2) * 0.012;
  });

  return { material, uniforms, groupRef, level, particles: style === 'particles' };
}

/** Голова из модели владельца: челюсть — в шейдере по `uJaw`. */
function ModelHead(props: Head3DProps) {
  const gltf = useLoader(GLTFLoader, HEAD_URL);
  const geometry = useMemo(() => {
    let g: BufferGeometry | null = null;
    gltf.scene.traverse((o) => {
      const mesh = o as Mesh;
      if (!g && mesh.isMesh) g = mesh.geometry;
    });
    if (!g) throw new Error('В head.glb нет меша');
    return g as BufferGeometry;
  }, [gltf]);
  const { material, groupRef, particles } = useHeadMotion(props, 'model');
  const { scale, offsetY } = HEAD_MODEL;
  const place = { scale, position: [0, offsetY * scale, 0] as [number, number, number] };
  return (
    <group ref={groupRef}>
      {particles ? <points geometry={geometry} material={material} {...place} /> : <mesh geometry={geometry} material={material} {...place} />}
    </group>
  );
}

/** Процедурная голова (пока модель грузится или если её нет): рот — морф `jawOpen` (в «частицах» рта нет). */
function ProceduralHead(props: Head3DProps) {
  const { head, neck } = useMemo(() => buildHeadGeometry(), []);
  const { material, groupRef, uniforms, particles } = useHeadMotion(props, 'attribute');
  const headRef = useRef<Mesh>(null);
  // R3F ставит geometry пропом после создания Mesh — словарь морфов собираем явно.
  useLayoutEffect(() => {
    headRef.current?.updateMorphTargets();
  }, [head]);
  useEffect(
    () => () => {
      head.dispose();
      neck.dispose();
    },
    [head, neck],
  );
  useFrame(() => {
    const mesh = headRef.current;
    const jaw = mesh?.morphTargetDictionary?.[JAW_OPEN];
    if (mesh?.morphTargetInfluences && jaw !== undefined) mesh.morphTargetInfluences[jaw] = uniforms.jaw.value;
  });
  if (particles) {
    return (
      <group ref={groupRef}>
        <points geometry={head} material={material} />
        <points geometry={neck} material={material} />
      </group>
    );
  }
  return (
    <group ref={groupRef}>
      <mesh ref={headRef} geometry={head} material={material} />
      <mesh geometry={neck} material={material} />
    </group>
  );
}

/** Модель не загрузилась (нет файла, сеть) — остаёмся на процедурной голове, без падения сцены. */
class ModelBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Карта окружения «студия» (RoomEnvironment → PMREM): без неё металл не отражает ничего и голова
 * выглядит плоской; с ней блики и градиенты дают объём. Считается один раз на контекст.
 */
function StudioEnvironment() {
  const gl = useThree((st) => st.gl);
  const scene = useThree((st) => st.scene);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0.85;
    room.dispose();
    pmrem.dispose();
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [gl, scene]);
  return null;
}

export default function Head3D(props: Head3DProps) {
  const fallback = <ProceduralHead {...props} />;
  const body = (
    <ModelBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <ModelHead {...props} />
      </Suspense>
    </ModelBoundary>
  );
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, -0.18, 4.3], fov: 34 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      aria-hidden="true"
    >
      <StudioEnvironment />
      <hemisphereLight args={['#e8edf5', '#15171c', 0.5]} />
      <directionalLight position={[-2.5, 2.5, 3]} intensity={1.8} />
      <directionalLight position={[3, 1, -2.5]} intensity={1.4} color="#dfe6ff" />
      <directionalLight position={[0, -2, 2]} intensity={0.3} />
      {body}
    </Canvas>
  );
}
