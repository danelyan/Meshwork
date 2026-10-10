/**
 * Версии «Плетения» (`weave2`–`weave4`) — направление нитей по чертам лица, материал как у `weave`
 * (решение владельца 10.10: основной стиль — первое «Плетение», доработки — его версиями).
 *
 * - `weave2` «кольца в ткани»: геометрия нитей от `brand` (параллели и меридианы на черепе, петли
 *   вокруг глаз, рта с носогубкой, носа и ушей), материал мягкий — тонкие частые нити по серой основе,
 *   широкая полоса перетока петель в сетку, без отдельного глазного яблока.
 * - `weave3` «обтекание»: ровно `weave` (трипланар, та же толщина, плотность и контраст), но фронтальная
 *   и боковая проекции локально повёрнуты по чертам: сетка обтекает глаза, рот, нос и уши, как поток
 *   вокруг препятствия (конформное отображение z + Σ R²/(z − c), клетки остаются квадратными).
 * - `weave4` «обтекание, тонкое»: `weave3` + мягкий материал из `weave2`.
 *
 * Вставки во фрагментный шейдер MeshStandardMaterial из Head3D.surfaceMaterial, как у brand-weave.ts:
 * функции — в шапку (после `fspLine`/`FSP_DARK`), блок цвета — после `#include <color_fragment>`.
 * Координаты — модели (`vModelPos`, до морфов рта): нити не скользят по коже, когда рот двигается.
 */
export const WEAVE_GLSL_HEAD = `
  #if defined(FSP_WEAVE2) || defined(FSP_WEAVE3) || defined(FSP_WEAVE4)
  // плотность: в крупном холсте нити чаще (до 1.7×), в маленьком (≈ 200 px, uGrid.x = 80) — как у weave,
  // иначе клетка меньше 3 px и рябит
  float fwBoost() { return clamp(uGrid.x / 125.0, 1.0, 1.7); }
  // тонкая нить по двум координатам: полуширина в пикселях (0.35…0.8 px), а не в долях клетки, — нить
  // не толстеет на большом холсте; где клетка мельче ~3 px, нити сливаются в средний тон ткани, а не в
  // тёмное (без муара и без «дыр»)
  vec2 fwThinAxes(vec2 cell, vec2 fw) {
    fw = max(fw, vec2(1e-5));
    vec2 px = (0.5 - abs(fract(cell) - 0.5)) / fw;
    vec2 h = clamp(uWidth / fw, vec2(0.35), vec2(0.8));
    vec2 a = 1.0 - smoothstep(h - 0.5, h + 0.5, px);
    return mix(a, vec2(0.2), smoothstep(0.22, 0.45, fw));
  }
  float fwThin(vec2 cell) {
    vec2 l = fwThinAxes(cell, fwidth(cell));
    return max(l.x, l.y);
  }
  // мягкий контраст: светло-серая нить по тёмно-серой основе того же металла (а не по почти чёрному)
  vec3 fwSoft(vec3 base, float line) {
    return mix(base * 0.13, base, clamp(line, 0.0, 1.0));
  }
  // смещение сетки вокруг черты — «диполь» обтекания: (z − c) → R²·conj(z − c)/|z − c|², сглаженный ε
  // в центре (нет особой точки) и погашенный за 4 радиусами (черты не тянут сетку на черепе).
  // ab — полуоси эллипса черты, s — сила (1 — сетка ложится по контуру, меньше — лишь изгибается).
  vec2 fwFlow(vec2 z, vec2 c, vec2 ab, float s) {
    vec2 q = (z - c) / ab;
    float r2 = dot(q, q);
    vec2 d = vec2(q.x, -q.y) / (r2 + 0.2) * ab;
    return d * s * (1.0 - smoothstep(4.0, 9.0, r2));
  }
  #endif

  #ifdef FSP_WEAVE2
  // петля-«стадион» вокруг отрезка 2L по X (как fspBrandLoop): кольца — 3D-расстояние, спицы — доля
  // пути по контуру; производные считаются до ветвлений
  float fwLoop(vec3 p, vec3 c, vec3 sc, float L, float k, float spokes, out float dist) {
    vec3 q = (p - c) * sc;
    vec2 e = vec2(q.x - clamp(q.x, -L, L), q.y);
    dist = length(vec3(e, q.z));
    float r = length(e);
    float th = atan(e.y, e.x);
    float sR = 4.0 * L + 3.1415927 * r + r * (th + 1.5707963);
    float sL = 2.0 * L + r * ((th < 0.0 ? th + 6.2831853 : th) - 1.5707963);
    float s = q.x > L ? sR : q.x < -L ? sL : q.y >= 0.0 ? L - q.x : 2.0 * L + 3.1415927 * r + q.x + L;
    float ang = s / max(4.0 * L + 6.2831853 * r, 1e-5) * spokes;
    float fa = min(fwidth(ang), fwidth(mod(ang + spokes * 0.5, spokes)));
    float ring = dist * k;
    vec2 l = fwThinAxes(vec2(ring, ang), vec2(fwidth(ring), fa));
    return max(l.x, l.y);
  }
  float fwRings(vec3 p, vec3 c, vec3 sc, float k, out float dist) {
    dist = length((p - c) * sc);
    float ring = dist * k;
    return fwThinAxes(vec2(ring, 0.25), vec2(fwidth(ring), 1.0)).x;
  }
  #endif
`;

export const WEAVE_GLSL_COLOR = `
  #ifdef FSP_WEAVE2
  {
    vec3 p = vModelPos;
    float k = uGrid.x * 0.6 * fwBoost();
    // череп: параллели и меридианы вокруг центра черепа (как brand), у макушки меридианы прорежены
    vec3 C = vec3(0.0, 0.62, -0.02);
    vec3 d = p - C;
    float R = 0.38;
    float lat = d.y > 0.0 ? R * acos(clamp(d.y / max(length(d), 1e-4), -1.0, 1.0)) : R * 1.5707963 - d.y;
    float polar = lat / R;
    float lod = polar < 0.22 ? 4.0 : polar < 0.5 ? 2.0 : 1.0;
    float nLon = floor(6.2831853 * R * k / 4.0 + 0.5) * 4.0 / lod;
    float lon = (atan(d.x, d.z) / 6.2831853 + 0.5) * nLon;
    float fLon = min(fwidth(lon), fwidth(mod(lon + nLon * 0.5, nLon)));
    vec2 bl = fwThinAxes(vec2(lat * k, lon), vec2(fwidth(lat * k), fLon));
    float line = max(bl.x, bl.y);
    // петли: глаза — миндаль; рот — широкая петля до крыльев носа (носогубные складки); нос — кольца;
    // уши — кольца вокруг раковины (профиль модели: ухо x ≈ ±0.30…0.37, y 0.44…0.62, z 0…0.08)
    float rEye = 0.085, rMouth = 0.1, rNose = 0.065, rEar = 0.09;
    float lEye = 0.02, lMouth = 0.035;
    float nEye = floor((4.0 * lEye + 3.7699 * rEye) * k * 0.45 + 0.5) * 2.0;
    float nMouth = floor((4.0 * lMouth + 3.7699 * rMouth) * k * 0.45 + 0.5) * 2.0;
    float dl, dr, dm, dn, de;
    float eyeL = fwLoop(p, vec3(-0.115, 0.632, 0.325), vec3(0.85, 1.15, 1.0), lEye, k, nEye, dl);
    float eyeR = fwLoop(p, vec3(0.115, 0.632, 0.325), vec3(0.85, 1.15, 1.0), lEye, k, nEye, dr);
    float mouth = fwLoop(p, vec3(0.0, 0.435, 0.41), vec3(0.7, 1.05, 0.5), lMouth, k, nMouth, dm);
    float nose = max(fwRings(p, vec3(0.0, 0.535, 0.42), vec3(0.9, 0.95, 0.45), k, dn), bl.y);
    float ear = max(fwRings(p, vec3(sign(p.x) * 0.27, 0.535, 0.035), vec3(0.45, 0.85, 1.0), k, de), bl.y);
    // широкий переток: петля набирает вес от 1.5 радиуса к 0.6 — в полосе нити двух семейств
    // плавно меняют яркость, без шва по контуру
    float wl = 1.0 - smoothstep(rEye * 0.6, rEye * 1.5, dl);
    float wr = 1.0 - smoothstep(rEye * 0.6, rEye * 1.5, dr);
    float wm = (1.0 - smoothstep(rMouth * 0.6, rMouth * 1.5, dm)) * smoothstep(0.15, 0.25, p.z);
    float wn = (1.0 - smoothstep(rNose * 0.6, rNose * 1.4, dn)) * smoothstep(0.3, 0.36, p.z);
    float we = (1.0 - smoothstep(rEar * 0.6, rEar * 1.4, de)) * smoothstep(0.2, 0.28, abs(p.x));
    line = mix(line, eyeL, wl);
    line = mix(line, eyeR, wr);
    line = mix(line, mouth, wm);
    line = mix(line, nose, wn);
    line = mix(line, ear, we);
    diffuseColor.rgb = fwSoft(diffuseColor.rgb, line);
  }
  #endif
  #if defined(FSP_WEAVE3) || defined(FSP_WEAVE4)
  {
    // трипланар weave, но фронтальная (xy) и боковая (zy) проекции обтекают черты
    vec3 p = vModelPos;
    vec3 n = normalize(vModelNormal);
    vec3 w = pow(abs(n), vec3(4.0));
    w /= (w.x + w.y + w.z);
    vec2 f = p.xy;
    f += fwFlow(p.xy, vec2(-0.115, 0.632), vec2(0.075, 0.045), 1.0);
    f += fwFlow(p.xy, vec2(0.115, 0.632), vec2(0.075, 0.045), 1.0);
    f += fwFlow(p.xy, vec2(0.0, 0.432), vec2(0.085, 0.04), 1.0);
    f += fwFlow(p.xy, vec2(0.0, 0.53), vec2(0.04, 0.055), 0.7);
    vec2 s = p.zy + fwFlow(p.zy, vec2(0.035, 0.535), vec2(0.06, 0.1), 1.0) * smoothstep(0.18, 0.26, abs(p.x));
    #ifdef FSP_WEAVE3
    float k = uGrid.x * 0.5;
    float line = fspLine(s * k) * w.x + fspLine(p.xz * k) * w.y + fspLine(f * k) * w.z;
    diffuseColor.rgb = mix(FSP_DARK, diffuseColor.rgb, clamp(line, 0.0, 1.0));
    #else
    float k = uGrid.x * 0.5 * fwBoost();
    float line = fwThin(s * k) * w.x + fwThin(p.xz * k) * w.y + fwThin(f * k) * w.z;
    diffuseColor.rgb = fwSoft(diffuseColor.rgb, line);
    #endif
  }
  #endif
`;
