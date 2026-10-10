'use client';

import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { Component, type ReactNode, type RefObject, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  type Group,
  type Material,
  type Mesh,
  Matrix3,
  MeshStandardMaterial,
  PMREMGenerator,
  type Points,
  ShaderMaterial,
  Vector3,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { BRAND_GLSL_COLOR, BRAND_GLSL_HEAD } from './brand-weave';
import { WEAVE_GLSL_COLOR, WEAVE_GLSL_HEAD } from './weave-versions';
import { buildHeadGeometry, JAW_OPEN } from './head-geometry';
import { DEFAULT_HEAD_STYLE, type HeadStyle } from './head-styles';
import {
  BASE_PITCH,
  BASE_YAW,
  DEFAULT_HEAD_MOTION,
  easeToward,
  headMotion,
  headPointer,
  type HeadMotionMode,
  livePose,
  NECK,
  neckPose,
  trackPose,
} from './head-motion';
import { mouthOpen, smoothLevel } from './level';
import { CLOSED, type MouthShape, smoothShape } from './lipsync';
import { DEFAULT_MOUTH_LOOK, type MouthLook, mouthLookIndex } from './mouth-looks';
import type { VoiceStatus } from './voice';

/**
 * Серебристая голова-сетка компаньона на тёмном фоне (брендбук ФСП, docs/research/assets-19).
 * Основная голова — модель владельца с ригом рта `public/avatar/head-mouth.glb` (без текстур, см.
 * README рядом): металл MeshStandardMaterial + сетка в фрагментном шейдере по положению вершины
 * (как ткань на референсе), рот — морфы JawOpen/LipRound/LipWide и полость/зубы/язык (`_mouth_part`).
 * Если этот файл не загрузился — прежняя `head.glb` с процедурным ртом в вершинном шейдере, пока
 * грузится или если и её нет — процедурная голова из head-geometry с морфом `jawOpen`.
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
  /** Ручной поворот (drag на демо-экране): прибавляется к повороту группы в каждом кадре. */
  getOrbit?: () => { yaw: number; pitch: number };
  /** Вид открытого рта (см. mouth-looks.ts); только у головы с ригом рта. */
  mouthLook?: MouthLook;
  /**
   * Движение (head-motion.ts): `classic` — покачивание группы; `karina` — слежение за курсором по всей
   * странице поворотом шеи, дыхание и моргание Карины; `alive` — то же + скулы, глаза, брови.
   */
  motion?: HeadMotionMode;
}

/** Цвета бренда: акцент `--blue` из tokens.css и серебро референса. */
const ACCENT = '#402fff';
const SILVER = '#c4c9d2';

export const HEAD_URL = '/avatar/head.glb';
/** Та же голова с разрезанными губами, полостью рта и морфами (scripts/build-head-mouth.mjs). */
export const HEAD_MOUTH_URL = '/avatar/head-mouth.glb';
/** Морфы рта в head-mouth.glb (`extras.targetNames`). */
export const MOUTH_MORPHS = { open: 'JawOpen', round: 'LipRound', wide: 'LipWide' } as const;

/**
 * Антропометрия модели в её координатах (высота 0…1 от основания шеи до макушки, лицо смотрит в +Z;
 * профиль снят скриптом при подготовке файла): линия рта, низ подбородка, ось челюсти на уровне ушей.
 */
export const HEAD_MODEL = {
  mouthY: 0.43,
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
  /** Шея: yaw, pitch, roll (рад), дыхание (подъём в единицах модели). */
  neck: { value: [number, number, number, number] };
  /** Живость: взгляд x/y −1…1, щёки 0…1, брови 0…1. */
  live: { value: [number, number, number, number] };
  time: { value: number };
  /** Половина высоты холста в px — для размера точек в режиме «частицы» (как `scale` у PointsMaterial). */
  pointScale: { value: number };
  /** Вид рта — индекс в MOUTH_LOOKS. */
  mouthLook: { value: number };
}

/** attribute — процедурная голова; model — head.glb с процедурным ртом; mouth — head-mouth.glb с морфами. */
type Mode = 'attribute' | 'model' | 'mouth';

/**
 * Процедурный рот без морфов: раскрытие в зоне губ (линия рта `uJawRegion.x`), а не поворот всей
 * челюсти. Нижняя губа опускается (вес максимален у линии рта, затухает к подбородку), верхняя
 * чуть поднимается, уголки сходятся к центру (округление), подбородок подхватывает лёгким поворотом
 * вокруг оси ушей. Всё — только спереди (z > 0) и в ширине рта (|x| < ~0.14 в координатах модели).
 * У модели с морфами (FSP_MORPH_MOUTH) губы и челюсть двигают морфы — от блока остаются улыбка
 * и моргание. Блок стоит после `begin_vertex`, морфы three прибавляет позже (`morphtarget_vertex`).
 */
const JAW_GLSL = `
  {
    float mouthY = uJawRegion.x;
    float width = 1.0 - smoothstep(0.09, 0.17, abs(position.x));
    float front = smoothstep(0.1, 0.3, position.z);
    float lips = width * front;
    float corner = smoothstep(0.06, 0.12, abs(position.x)) * width * front * (1.0 - smoothstep(0.04, 0.07, abs(position.y - mouthY)));
    #ifndef FSP_MORPH_MOUTH
    float open = uMouth.x * lips;
    // зона губ: узкая полоса вокруг линии рта; уголки — её края по X
    float lipBand = smoothstep(mouthY - 0.05, mouthY - 0.015, position.y) * (1.0 - smoothstep(mouthY + 0.015, mouthY + 0.05, position.y));
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
    // подбородок слегка следует за нижней губой (поворот вокруг оси ушей)
    float chin = smoothstep(mouthY, uJawRegion.y - 0.02, position.y) * smoothstep(uJawRegion.y - 0.06, uJawRegion.y - 0.02, position.y);
    float a = uMouth.x * uJawRegion.w * 0.35 * chin * smoothstep(-0.12, 0.1, position.z);
    float c = cos(a), sn = sin(a);
    vec2 pv = vec2(transformed.y - uJawRegion.z, transformed.z);
    transformed.y = uJawRegion.z + pv.x * c - pv.y * sn;
    transformed.z = pv.x * sn + pv.y * c;
    #endif
    // улыбка: уголки вверх (у модели с морфами — поверх них: морфы прибавляются после этого блока)
    transformed.y += uFace.y * 0.014 * corner;
    // моргание: верхнее веко опускается к линии глаза (центры глаз — как в стиле «петли»)
    float eyeY = 0.63;
    float dEye = min(distance(position.xy, vec2(-0.115, eyeY)), distance(position.xy, vec2(0.115, eyeY)));
    float lid = (1.0 - smoothstep(0.035, 0.06, dEye)) * smoothstep(eyeY - 0.005, eyeY + 0.01, position.y) * smoothstep(0.05, 0.2, position.z);
    transformed.y -= uFace.x * lid * (position.y - eyeY) * 0.85;
  }`;

/**
 * «Живость» лица (режим alive, uniform `uLive`: взгляд x/y, щёки, брови), в координатах модели до морфов:
 * зона глаз (глазницы и веки) чуть сдвигается к курсору, скулы приподнимаются при улыбке и речи,
 * брови поднимаются, когда думает. Амплитуды — миллиметры модели, без карикатуры. При uLive = 0 — ничего.
 */
const LIVE_GLSL = `
  {
    float front = smoothstep(0.05, 0.2, position.z);
    float dEye = min(distance(position.xy, vec2(-0.115, 0.63)), distance(position.xy, vec2(0.115, 0.63)));
    float eyeZone = (1.0 - smoothstep(0.03, 0.075, dEye)) * front;
    transformed.xy += uLive.xy * vec2(0.006, 0.004) * eyeZone;
    float dCheek = min(distance(position.xy, vec2(-0.11, 0.52)), distance(position.xy, vec2(0.11, 0.52)));
    float cheek = (1.0 - smoothstep(0.02, 0.075, dCheek)) * front;
    transformed.y += uLive.z * 0.007 * cheek;
    transformed.z += uLive.z * 0.004 * cheek;
    float dBrow = min(distance(position.xy, vec2(-0.1, 0.70)), distance(position.xy, vec2(0.1, 0.70)));
    float brow = (1.0 - smoothstep(0.02, 0.065, dBrow)) * front;
    transformed.y += uLive.w * 0.006 * brow;
  }`;

/**
 * Поворот шеи (режимы karina/alive, uniform `uNeck`: yaw, pitch, roll, дыхание), как в renderer Карины:
 * вершины поворачиваются вокруг pivot внутри шеи с весом по высоте (основание на месте, от подбородка
 * и выше — жёстко). Стоит ПОСЛЕ `morphtarget_vertex`: дельты морфов рта заданы в покое модели и
 * должны повернуться вместе с головой. Нормали — тем же поворотом после `morphnormal_vertex`.
 */
const NECK_GLSL_HEAD = `
  uniform vec4 uNeck;
  uniform vec4 uLive;
  float fspNeckW(float y) { return smoothstep(${NECK.from.toFixed(3)}, ${NECK.to.toFixed(3)}, y); }
  mat3 fspNeckRot(float w) {
    float a = uNeck.x * w, b = uNeck.y * w, r = uNeck.z * w;
    float ca = cos(a), sa = sin(a), cb = cos(b), sb = sin(b), cr = cos(r), sr = sin(r);
    return mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca) * mat3(1.0, 0.0, 0.0, 0.0, cb, sb, 0.0, -sb, cb) * mat3(cr, sr, 0.0, -sr, cr, 0.0, 0.0, 0.0, 1.0);
  }`;
const NECK_GLSL = `
  {
    float neckW = fspNeckW(position.y);
    vec3 neckPivot = vec3(0.0, ${NECK.pivotY.toFixed(3)}, ${NECK.pivotZ.toFixed(3)});
    transformed = fspNeckRot(neckW) * (transformed - neckPivot) + neckPivot;
    transformed.y += uNeck.w * neckW;
  }`;
const NECK_NORMAL_GLSL = `objectNormal = fspNeckRot(fspNeckW(position.y)) * objectNormal;`;

const JAW_REGION = [HEAD_MODEL.mouthY, HEAD_MODEL.chinY, HEAD_MODEL.jawPivotY, HEAD_MODEL.jawAngle];

/** Параметры MeshStandardMaterial по стилю (частицы — отдельный ShaderMaterial, см. particlesMaterial). */
const SURFACE: Record<Exclude<HeadStyle, 'particles'>, ConstructorParameters<typeof MeshStandardMaterial>[0]> = {
  metal: { color: new Color(SILVER), metalness: 0.55, roughness: 0.36 },
  grid: { color: new Color('#a4aab4'), metalness: 0.6, roughness: 0.34 },
  weave: { color: new Color('#a4aab4'), metalness: 0.6, roughness: 0.34 },
  brand: { color: new Color('#b4bac4'), metalness: 0.62, roughness: 0.32 },
  weave2: { color: new Color('#a4aab4'), metalness: 0.6, roughness: 0.34 },
  weave3: { color: new Color('#a4aab4'), metalness: 0.6, roughness: 0.34 },
  weave4: { color: new Color('#a4aab4'), metalness: 0.6, roughness: 0.34 },
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
  const model = mode !== 'attribute';
  const defines = model ? `#define FSP_MODEL${mode === 'mouth' ? '\n#define FSP_MORPH_MOUTH' : ''}` : '';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uGrid = u.grid;
    shader.uniforms.uWidth = { value: GRID.width };
    shader.uniforms.uJaw = u.jaw;
    shader.uniforms.uMouth = u.mouth;
    shader.uniforms.uFace = u.face;
    shader.uniforms.uNeck = u.neck;
    shader.uniforms.uLive = u.live;
    shader.uniforms.uTime = u.time;
    shader.uniforms.uJawRegion = { value: JAW_REGION };
    shader.uniforms.uAccent = { value: new Color(ACCENT) };
    shader.uniforms.uSilver = { value: new Color(SILVER) };
    shader.uniforms.uMouthLook = u.mouthLook;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#define STANDARD',
        `#define STANDARD
        ${model ? defines : 'attribute vec2 gridUv;'}
        #ifdef FSP_MORPH_MOUTH
        attribute float _mouth_part;
        attribute float _lip_wall;
        #endif
        varying vec2 vGridUv;
        varying vec3 vModelPos;
        varying vec3 vModelNormal;
        varying float vMouth;
        varying float vPart;
        varying float vWall;
        uniform float uJaw;
        uniform vec4 uMouth;
        uniform vec4 uFace;
        uniform vec4 uJawRegion;
        ${NECK_GLSL_HEAD}`,
      )
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vModelPos = position;
        vModelNormal = normal;
        vMouth = 0.0;
        vPart = 0.0;
        vWall = 0.0;
        #ifdef FSP_MORPH_MOUTH
          vPart = _mouth_part;
          vWall = _lip_wall;
        #endif
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
        ${LIVE_GLSL}
        #endif`,
      )
      .replace(
        '#include <morphnormal_vertex>',
        `#include <morphnormal_vertex>
        #ifdef FSP_MODEL
        ${NECK_NORMAL_GLSL}
        #endif`,
      )
      .replace(
        '#include <morphtarget_vertex>',
        `#include <morphtarget_vertex>
        #ifdef FSP_MODEL
        ${NECK_GLSL}
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#define STANDARD',
        `#define STANDARD
        #define FSP_${style.toUpperCase()}
        ${mode === 'mouth' ? '#define FSP_MORPH_MOUTH' : ''}
        varying vec2 vGridUv;
        varying vec3 vModelPos;
        varying vec3 vModelNormal;
        varying float vMouth;
        varying float vPart;
        varying float vWall;
        uniform vec4 uMouth;
        uniform vec2 uGrid;
        uniform float uWidth;
        uniform float uTime;
        uniform float uJaw;
        uniform vec4 uJawRegion;
        uniform vec3 uAccent;
        uniform vec3 uSilver;
        uniform float uMouthLook;
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
        ${BRAND_GLSL_HEAD}
        ${WEAVE_GLSL_HEAD}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // полость открытого рта: темно, без нитей
        float mouthDark = 1.0 - clamp(vMouth * 2.5, 0.0, 0.92);
        // доля металла и бликов окружения (1 — как у головы, 0 — матово и без отражений)
        float mouthSpec = mouthDark;
        vec3 mouthGlow = vec3(0.0);
        // части рига: 0 голова, 1 полость, 2 зубы, 3 язык; при сомкнутых губах прячем всё, кроме головы
        float part = floor(vPart + 0.5);
        #ifdef FSP_MORPH_MOUTH
        // вид рта (mouth-looks.ts): 0 полость, 1 полость + нити, 2 приглушённые зубы, 3 свечение, 4 как было
        int look = int(uMouthLook + 0.5);
        if (part > 0.5 && uMouth.x < 0.08) discard;
        if (part > 1.5 && look != 2 && look != 4) discard;
        // глубина рта по оси взгляда: 0 у кромки губ (z ≈ 0.44), 1 у задней стенки полости (z ≈ 0.33)
        float depth = smoothstep(0.44, 0.31, vModelPos.z);
        float wall = smoothstep(0.0, 0.6, vWall);
        if (look == 4) {
          if (part > 0.5) mouthDark = part > 2.5 ? 0.3 : part > 1.5 ? 1.0 : 0.06;
          // стенки губ уходят в полость: от края губы к глубине — в тёмное
          else mouthDark = 1.0 - 0.94 * wall;
          mouthSpec = mouthDark;
        } else {
          // цвет задаём ниже целиком; блики гаснут уже у самой кромки губы, внутри рта их нет
          mouthDark = 1.0;
          mouthSpec = part > 0.5 ? 0.0 : 1.0 - smoothstep(0.0, 0.2, vWall);
        }
        // изнутри головы (видно в уголках открытого рта) — тёмная полость
        if (!gl_FrontFacing) { mouthDark = 0.04; mouthSpec = 0.0; }
        #endif
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
          vec2 eyeL = vec2(-0.115, 0.63), eyeR = vec2(0.115, 0.63), mouth = vec2(0.0, uJawRegion.x);
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
        ${WEAVE_GLSL_COLOR}
        diffuseColor.rgb *= mouthDark;
        #ifdef FSP_MORPH_MOUTH
        if (look == 4) {
          // прежний вид: полость и изнанка ровно тёмные, зубы светлые, язык тёплый тёмный
          if ((part > 0.5 && part < 1.5) || !gl_FrontFacing) diffuseColor.rgb = vec3(0.012, 0.009, 0.011);
          if (part > 1.5 && part < 2.5) diffuseColor.rgb = vec3(0.8, 0.82, 0.86);
          if (part > 2.5) diffuseColor.rgb = vec3(0.16, 0.07, 0.08);
        } else {
          // тень полости вместо AO: свет окружения внутрь рта почти не попадает. Полость видна почти
          // анфас, поэтому глубину рисуем виньеткой по отверстию: у краёв (свет заходит из-за губ) — тёмный
          // тёплый, к центру — чёрный; плюс вглубь по z и тень под верхней губой (центр полости x ≈ −0.02,
          // y ≈ 0.41, полуоси 0.075 × 0.045 — по head-mouth.glb до морфов)
          float rim = smoothstep(0.35, 1.15, length(vec2((vModelPos.x + 0.021) / 0.075, (vModelPos.y - 0.41) / 0.045)));
          float floorLit = smoothstep(0.445, 0.385, vModelPos.y);
          float lit = rim * (1.0 - 0.6 * depth) * (0.45 + 0.55 * floorLit);
          vec3 inner = mix(vec3(0.0015, 0.0015, 0.002), vec3(0.06, 0.038, 0.042), lit);
          if (look == 1) {
            // нити сетки продолжаются внутрь (та же трипланарная клетка, что у «плетения») и гаснут вглубь
            vec3 n = normalize(vModelNormal);
            vec3 w = pow(abs(n), vec3(4.0));
            w /= (w.x + w.y + w.z);
            float k = uGrid.x * 0.5;
            float line = fspLine(vModelPos.yz * k) * w.x + fspLine(vModelPos.xz * k) * w.y + fspLine(vModelPos.xy * k) * w.z;
            // нити видны у краёв и тонут к центру — ткань уходит в темноту, а не натянута сеткой
            float fade = rim * (1.0 - 0.4 * depth);
            inner = mix(inner, uSilver * 0.3, clamp(line, 0.0, 1.0) * fade * fade);
          }
          // стенки губ плавно переходят от поверхности головы в полость
          if (part < 0.5) diffuseColor.rgb = mix(diffuseColor.rgb, inner, wall);
          if ((part > 0.5 && part < 1.5) || !gl_FrontFacing) diffuseColor.rgb = inner;
          // приглушённые зубы и язык: матовые, в тени, темнеют вглубь
          if (part > 1.5 && part < 2.5) diffuseColor.rgb = mix(vec3(0.03, 0.03, 0.034), vec3(0.006, 0.006, 0.008), depth);
          if (part > 2.5) diffuseColor.rgb = mix(vec3(0.045, 0.018, 0.022), vec3(0.008, 0.004, 0.005), depth);
          if (look == 3 && (part > 0.5 || wall > 0.0 || !gl_FrontFacing)) {
            // «цифровой» рот: свечение акцентом идёт из глубины и к губам гаснет
            float g = (0.008 + 0.12 * (1.0 - rim) * depth) * (part > 0.5 || !gl_FrontFacing ? 1.0 : wall);
            mouthGlow = uAccent * g * smoothstep(0.08, 0.3, uMouth.x);
          }
        }
        #endif
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
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(1.0, roughnessFactor, mouthSpec);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= mouthSpec;')
      // у диэлектрика F0 = 0.04, но F90 = 1: на скользящих углах стенки губ отражали студию почти белым —
      // внутри рта гасим и френелевский блик
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        #ifdef FSP_MORPH_MOUTH
        material.specularColor *= mouthSpec;
        material.specularColorBlended *= mouthSpec;
        material.specularF90 *= mouthSpec;
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += mouthGlow;
        #ifdef FSP_HOLOGRAM
        if (part < 0.5 && gl_FrontFacing)
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
  // губы разрезаны: в уголках открытого рта видна изнанка головы — рисуем её тёмной, а не дырой
  if (mode === 'mouth' && style !== 'wire') m.side = DoubleSide;
  return m;
}

/** Облако точек по вершинам головы: на речи точки у рта разлетаются вдоль нормали (HeadLab «частицы»). */
function particlesMaterial(u: HeadUniforms, mode: Mode): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uJaw: u.jaw,
      uMouth: u.mouth,
      uFace: u.face,
      uNeck: u.neck,
      uLive: u.live,
      uTime: u.time,
      uPointScale: u.pointScale,
      uJawRegion: { value: JAW_REGION },
      uAccent: { value: new Color(ACCENT) },
      uSilver: { value: new Color(SILVER) },
    },
    defines: mode === 'attribute' ? {} : mode === 'mouth' ? { FSP_MODEL: '', FSP_MORPH_MOUTH: '' } : { FSP_MODEL: '' },
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
      varying float vHide;
      ${NECK_GLSL_HEAD}
      #ifdef FSP_MORPH_MOUTH
      attribute float _mouth_part;
      #include <morphtarget_pars_vertex>
      #endif
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 transformed = position;
        float seed = hash(position);
        vec3 objectNormal = normal;
        #ifdef FSP_MODEL
        ${JAW_GLSL}
        ${LIVE_GLSL}
        #endif
        vHide = 0.0;
        #ifdef FSP_MORPH_MOUTH
        #include <morphtarget_vertex>
        vHide = _mouth_part > 0.5 && uMouth.x < 0.08 ? 1.0 : 0.0;
        #endif
        #ifdef FSP_MODEL
        ${NECK_GLSL}
        ${NECK_NORMAL_GLSL}
        #endif
        // лёгкое мерцание облака + разлёт по нормали от громкости
        transformed += objectNormal * (0.004 * sin(uTime * 1.5 + seed * 40.0) + uJaw * 0.03 * seed);
        vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
        vFacing = abs(normalize(normalMatrix * objectNormal).z);
        vSeed = seed;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (0.028 + seed * 0.022) * uPointScale / -mv.z;
      }`,
    fragmentShader: `
      uniform vec3 uAccent;
      uniform vec3 uSilver;
      varying float vFacing;
      varying float vSeed;
      varying float vHide;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5 || vHide > 0.5) discard;
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
    () => ({ grid: { value: gridDensity(160) }, jaw: { value: 0 }, mouth: { value: [0, 0, 0, 0] }, face: { value: [0, 0, 0, 0] }, neck: { value: [0, 0, 0, 0] }, live: { value: [0, 0, 0, 0] }, time: { value: 0 }, pointScale: { value: 80 }, mouthLook: { value: 0 } }),
    [],
  );
  useEffect(() => {
    const g = gridDensity(height);
    uniforms.grid.value = mode === 'attribute' ? g : sphericalGrid(g);
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
  const motionMode = props.motion ?? DEFAULT_HEAD_MOTION;
  const tracking = motionMode !== 'classic' && !props.reducedMotion;
  // курсор (нормированный −1…1 относительно головы, как у Карины), сглаженная поза и время анимации
  const track = useRef({ pointer: [0, 0] as [number, number], pose: trackPose(0, 0), gaze: [0, 0] as [number, number], time: 0 });
  const canvas = useThree((st) => st.gl.domElement);
  useEffect(() => {
    if (!tracking) {
      track.current.pointer = [0, 0];
      return;
    }
    // вся страница — цель взгляда, включая колонку чата; центр — голова (40 % высоты холста)
    const move = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const r = canvas.getBoundingClientRect();
      track.current.pointer = headPointer(e.clientX, e.clientY, innerWidth, innerHeight, r.left + r.width / 2, r.top + r.height * 0.4);
    };
    const leave = () => {
      track.current.pointer = [0, 0];
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerleave', leave);
    return () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerleave', leave);
    };
  }, [tracking, canvas]);

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
    const thinkingNow = s === 'thinking' || s === 'loading';
    const smile = props.reducedMotion ? 0 : speaking ? 0.35 : thinkingNow ? 0 : 0.15;
    uniforms.time.value = props.reducedMotion ? 0 : t;
    uniforms.mouthLook.value = mouthLookIndex(props.mouthLook ?? DEFAULT_MOUTH_LOOK);
    const g = groupRef.current;
    const orbit = props.getOrbit?.();
    const motion = props.reducedMotion ? 0 : 1;

    if (motionMode !== 'classic') {
      // как у Карины: время идёт только пока кадр рисуется (скрытая вкладка/вне экрана — пауза)
      const tr = track.current;
      if (motion) tr.time += step;
      const goal = trackPose(tr.pointer[0], tr.pointer[1]);
      tr.pose = [easeToward(tr.pose[0], goal[0], step), easeToward(tr.pose[1], goal[1], step)];
      tr.gaze = [easeToward(tr.gaze[0], tr.pointer[0], step, 9), easeToward(tr.gaze[1], tr.pointer[1], step, 9)];
      const idle = headMotion(tr.time);
      uniforms.face.value = [motion * idle.blink, smile, 0, 0];
      const neck = neckPose({ pose: tr.pose, time: tr.time, thinking: motion > 0 && thinkingNow, level: motion * level.current });
      uniforms.neck.value = mode === 'attribute' ? [0, 0, 0, 0] : neck;
      uniforms.live.value = motionMode === 'alive' && motion ? livePose({ gaze: tr.gaze, smile, open: m.open, thinking: thinkingNow }) : [0, 0, 0, 0];
      if (!g) return;
      // группа (вместе с основанием шеи) стоит; на демо её крутит drag. У процедурной головы шеи в шейдере нет —
      // поворачиваем группу целиком.
      const whole = mode === 'attribute' ? 1 : 0;
      g.rotation.y = BASE_YAW + (orbit?.yaw ?? 0) + whole * neck[0];
      g.rotation.x = BASE_PITCH + (orbit?.pitch ?? 0) + whole * neck[1];
      g.rotation.z = whole * neck[2];
      g.position.y = 0;
      return;
    }

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
    uniforms.face.value = [props.reducedMotion ? 0 : lid, smile, 0, 0];
    uniforms.neck.value = [0, 0, 0, 0];
    uniforms.live.value = [0, 0, 0, 0];
    if (!g) return;
    // покой: дыхание и лёгкое покачивание; «думает» — наклон и медленный поворот; говорит — кивки в такт
    const thinking = thinkingNow ? 1 : 0;
    g.rotation.y = -0.42 + (orbit?.yaw ?? 0) + motion * (Math.sin(t * 0.4) * 0.06 + thinking * Math.sin(t * 0.9) * 0.12);
    g.rotation.x = -0.1 + (orbit?.pitch ?? 0) + motion * (Math.sin(t * 0.55) * 0.02 + thinking * 0.08 + level.current * 0.2);
    g.rotation.z = motion * thinking * 0.06;
    g.position.y = motion * Math.sin(t * 1.2) * 0.012;
  });
  return { material, uniforms, groupRef, level, particles: style === 'particles' };
}

/**
 * Геометрия из head-mouth.glb в единицах модели. Файл квантован (KHR_mesh_quantization): позиции —
 * int16 с масштабом и сдвигом в узле. Шейдер считает сетку и зону рта по `position`, поэтому
 * возвращаем float-позиции, применив матрицу узла (дельты морфов — только масштаб).
 */
export function modelSpaceGeometry(mesh: Mesh, targetNames: readonly string[]): BufferGeometry {
  mesh.updateWorldMatrix(true, false);
  const m = mesh.matrixWorld;
  const linear = new Matrix3().setFromMatrix4(m);
  const src = mesh.geometry;
  const v = new Vector3();
  const floats = (a: BufferAttribute, fn: (x: Vector3) => Vector3) => {
    const out = new Float32Array(a.count * 3);
    for (let i = 0; i < a.count; i++) fn(v.fromBufferAttribute(a, i)).toArray(out, i * 3);
    return new BufferAttribute(out, 3);
  };
  const g = new BufferGeometry();
  g.setIndex(src.index);
  g.setAttribute('position', floats(src.getAttribute('position') as BufferAttribute, (x) => x.applyMatrix4(m)));
  g.setAttribute('normal', floats(src.getAttribute('normal') as BufferAttribute, (x) => x.normalize()));
  // части рта и стенки губ (scripts/build-head-mouth.mjs) — как есть
  for (const name of ['_mouth_part', '_lip_wall']) {
    const a = src.getAttribute(name);
    if (a) g.setAttribute(name, a);
  }
  const morph = (list: BufferAttribute[] | undefined, fn: (x: Vector3) => Vector3) =>
    (list ?? []).map((a, i) => Object.assign(floats(a, fn), { name: targetNames[i] ?? String(i) }));
  g.morphAttributes.position = morph(src.morphAttributes.position as BufferAttribute[], (x) => x.applyMatrix3(linear));
  g.morphAttributes.normal = morph(src.morphAttributes.normal as BufferAttribute[], (x) => x);
  g.morphTargetsRelative = true;
  g.computeBoundingSphere();
  return g;
}

/** Голова с ригом рта: висемы → морфы JawOpen/LipRound/LipWide, полость/зубы/язык — по `_mouth_part`. */
function MouthHead(props: Head3DProps) {
  const gltf = useLoader(GLTFLoader, HEAD_MOUTH_URL, (loader) => {
    loader.setMeshoptDecoder(MeshoptDecoder);
  });
  const geometry = useMemo(() => {
    let mesh: Mesh | null = null;
    gltf.scene.traverse((o) => {
      if (!mesh && (o as Mesh).isMesh) mesh = o as Mesh;
    });
    if (!mesh) throw new Error('В head-mouth.glb нет меша');
    const names = Object.values(MOUTH_MORPHS);
    const g = modelSpaceGeometry(mesh, names);
    if (g.morphAttributes.position?.length !== names.length || !g.getAttribute('_mouth_part')) throw new Error('В head-mouth.glb нет рига рта');
    return g;
  }, [gltf]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const { material, groupRef, uniforms, particles } = useHeadMotion(props, 'mouth');
  const meshRef = useRef<Mesh>(null);
  // R3F ставит geometry пропом после создания объекта — словарь морфов собираем явно.
  useLayoutEffect(() => {
    meshRef.current?.updateMorphTargets();
  }, [geometry, particles]);
  useFrame(() => {
    const mesh = meshRef.current;
    const dict = mesh?.morphTargetDictionary;
    const w = mesh?.morphTargetInfluences;
    if (!dict || !w) return;
    const [open, round, wide, press] = uniforms.mouth.value;
    const set = (name: string, value: number) => {
      const i = dict[name];
      if (i !== undefined) w[i] = Math.min(1, Math.max(0, value));
    };
    // смыкание (п/б/м): челюсть закрыта, губы чуть собраны; растяжение слабее при округлении
    set(MOUTH_MORPHS.open, open * (1 - press));
    set(MOUTH_MORPHS.round, round + press * 0.3);
    set(MOUTH_MORPHS.wide, wide * (1 - round * 0.5));
  });
  const { scale, offsetY } = HEAD_MODEL;
  const place = { scale, position: [0, offsetY * scale, 0] as [number, number, number] };
  return (
    <group ref={groupRef}>
      {particles ? (
        <points ref={meshRef as unknown as RefObject<Points>} geometry={geometry} material={material} {...place} />
      ) : (
        <mesh ref={meshRef} geometry={geometry} material={material} {...place} />
      )}
    </group>
  );
}

/** Голова из модели владельца без рига (запасная): рот — процедурный, в вершинном шейдере. */
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

/**
 * Как у Карины: кадры не рисуются, пока вкладка скрыта или холст вне экрана (frameloop `never`),
 * время анимации при этом стоит (оно копится только в кадрах, см. useHeadMotion).
 */
function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const el = ref.current;
    let inView = true;
    const update = () => setShown(inView && !document.hidden);
    const io =
      typeof IntersectionObserver === 'function'
        ? new IntersectionObserver((entries) => {
            inView = entries[0]?.isIntersecting ?? true;
            update();
          })
        : null;
    if (el) io?.observe(el);
    document.addEventListener('visibilitychange', update);
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', update);
    };
  }, [ref]);
  return shown;
}

export default function Head3D(props: Head3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const shown = useOnScreen(wrapRef);
  const fallback = <ProceduralHead {...props} />;
  const plain = (
    <ModelBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <ModelHead {...props} />
      </Suspense>
    </ModelBoundary>
  );
  // голова с ригом рта; не загрузилась — прежняя head.glb, не загрузилась и она — процедурная
  const body = (
    <ModelBoundary fallback={plain}>
      <Suspense fallback={fallback}>
        <MouthHead {...props} />
      </Suspense>
    </ModelBoundary>
  );
  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <Canvas
        frameloop={shown ? 'always' : 'never'}
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
    </div>
  );
}
