/**
 * Стиль «Плетение 2» (`brand`) — нити по форме лица, как на голове брендбука ФСП
 * (docs/research/assets-19-fsp-wireframe-head.png): на черепе параллели и меридианы вокруг центра
 * черепа, вокруг глаз и рта — кольца и спицы, как петли квад-ретопологии. Кольца — изолинии
 * 3D-расстояния (эллипсоид) до точки за поверхностью черты, поэтому они огибают глазницу и губы по
 * рельефу, а не лежат во фронтальной плоскости, как в «петлях». Координаты — модели (`vModelPos`,
 * до деформации рта): нити не скользят по коже, когда рот двигается.
 *
 * Вставки во фрагментный шейдер MeshStandardMaterial из Head3D.surfaceMaterial: функции — в шапку,
 * блок цвета — после `#include <color_fragment>`. Используют параметры шапки (`uWidth`, `uGrid`) и
 * `FSP_DARK`; центры черт — свои, по профилю модели, а не `HEAD_MODEL`: петли привязаны к коже, а не
 * к калибровке челюсти.
 */
export const BRAND_GLSL_HEAD = `
  #ifdef FSP_BRAND
  // линия по двум координатам с явной производной (у угловых координат на шве fwidth врёт)
  vec2 fspLineAxes(vec2 cell, vec2 fw) {
    vec2 d = abs(fract(cell) - 0.5);
    vec2 a = smoothstep(0.5 - uWidth - fw, 0.5 - uWidth + fw * 0.5, d);
    // слишком частые линии (у полюса, в центре колец) гаснут — без муара
    return a * (1.0 - smoothstep(0.3, 0.7, fw));
  }
  // экранная производная угла с n делениями: берём меньшую из двух копий с разными швами
  float fspSeamFw(float a, float n) {
    return min(fwidth(a), fwidth(mod(a + n * 0.5, n)));
  }
  // петля вокруг черты — «стадион» вокруг отрезка длиной 2L по X (щель губ, разрез глаза; L = 0 — круг):
  // кольца — 3D-расстояние до отрезка в метрике sc, поэтому огибают рельеф; спицы — доля пути по
  // контуру стадиона (на прямых участках вертикальны, на закруглениях веером), без звезды в центре.
  // dist — расстояние, по нему вес зоны; k — линий на единицу модели; spokes — чётное число спиц.
  float fspBrandLoop(vec3 p, vec3 c, vec3 sc, float L, float k, float spokes, out float dist) {
    vec3 q = (p - c) * sc;
    vec2 e = vec2(q.x - clamp(q.x, -L, L), q.y);
    dist = length(vec3(e, q.z));
    float r = length(e);
    float s;
    if (q.x > L) {
      s = 4.0 * L + 3.1415927 * r + r * (atan(e.y, e.x) + 1.5707963);
    } else if (q.x < -L) {
      float th = atan(e.y, e.x);
      s = 2.0 * L + r * ((th < 0.0 ? th + 6.2831853 : th) - 1.5707963);
    } else if (q.y >= 0.0) {
      s = L - q.x;
    } else {
      s = 2.0 * L + 3.1415927 * r + q.x + L;
    }
    float ang = s / max(4.0 * L + 6.2831853 * r, 1e-5) * spokes;
    float ring = dist * k;
    vec2 l = fspLineAxes(vec2(ring, ang), vec2(fwidth(ring), fspSeamFw(ang, spokes)));
    return max(l.x, l.y);
  }
  // только кольца (без спиц): для носа, где спицы сходились бы звездой на кончике
  float fspBrandRings(vec3 p, vec3 c, vec3 sc, float k, out float dist) {
    dist = length((p - c) * sc);
    float ring = dist * k;
    return fspLineAxes(vec2(ring, 0.25), vec2(fwidth(ring), 1.0)).x;
  }
  #endif
`;

export const BRAND_GLSL_COLOR = `
  #ifdef FSP_BRAND
  {
    vec3 p = vModelPos;
    // линий на единицу модели: в 1.5 раза гуще «сетки» (≈ 0.4·u на обхват лица), как на референсе
    float k = uGrid.x * 0.6;
    // череп: параллели — дуга от макушки по сфере вокруг центра черепа, ниже экватора (уровень
    // глаз) — горизонтальные срезы; меридианы — долгота вокруг вертикальной оси
    vec3 C = vec3(0.0, 0.62, -0.02);
    vec3 d = p - C;
    float R = 0.38;
    float lat = d.y > 0.0 ? R * acos(clamp(d.y / max(length(d), 1e-4), -1.0, 1.0)) : R * 1.5707963 - d.y;
    // у макушки меридианы сходятся — их число там вдвое и вчетверо меньше (как кольца-уровни на
    // ретопологии), иначе на затылке муар; уровень — по полярному углу, граница — по параллели
    float polar = lat / R;
    float lod = polar < 0.22 ? 4.0 : polar < 0.5 ? 2.0 : 1.0;
    float nLon = floor(6.2831853 * R * k / 4.0 + 0.5) * 4.0 / lod;
    float lon = (atan(d.x, d.z) / 6.2831853 + 0.5) * nLon;
    vec2 bl = fspLineAxes(vec2(lat * k, lon), vec2(fwidth(lat * k), fspSeamFw(lon, nLon)));
    float line = max(bl.x, bl.y);
    // петли черт: глаза — миндаль вокруг разреза; рот — по щели губ (профиль модели: подбородок 0.33,
    // складка 0.37, нижняя губа 0.40, щель 0.43, верхняя губа 0.455, под носом 0.49), шире и площе;
    // нос — кольца вокруг кончика (0.55) и крыльев
    float lipsY = 0.43;
    float rEye = 0.078, rMouth = 0.082, rNose = 0.065;
    float lEye = 0.02, lMouth = 0.03;
    float nEye = floor((4.0 * lEye + 3.7699 * rEye) * k * 0.45 + 0.5) * 2.0;
    float nMouth = floor((4.0 * lMouth + 3.7699 * rMouth) * k * 0.45 + 0.5) * 2.0;
    float dl, dr, dm, dn;
    float eyeL = fspBrandLoop(p, vec3(-0.115, 0.632, 0.325), vec3(0.85, 1.15, 1.0), lEye, k, nEye, dl);
    float eyeR = fspBrandLoop(p, vec3(0.115, 0.632, 0.325), vec3(0.85, 1.15, 1.0), lEye, k, nEye, dr);
    float mouth = fspBrandLoop(p, vec3(0.0, lipsY, 0.41), vec3(0.75, 1.0, 0.5), lMouth, k, nMouth, dm);
    // нос: горизонтали-кольца по рельефу, вдоль спинки — те же меридианы, что на лице
    float nose = max(fspBrandRings(p, vec3(0.0, 0.535, 0.42), vec3(0.9, 0.95, 0.45), k, dn), bl.y);
    // граница зоны — узкая: как стык петли с сеткой на ретопологии, без двойной клетки
    float wl = 1.0 - smoothstep(rEye * 0.9, rEye, dl);
    float wr = 1.0 - smoothstep(rEye * 0.9, rEye, dr);
    float wm = (1.0 - smoothstep(rMouth * 0.9, rMouth, dm)) * smoothstep(0.15, 0.25, p.z);
    float wn = (1.0 - smoothstep(rNose * 0.9, rNose, dn)) * smoothstep(0.3, 0.36, p.z);
    line = mix(line, eyeL, wl);
    line = mix(line, eyeR, wr);
    line = mix(line, mouth, wm);
    line = mix(line, nose, wn);
    // глазное яблоко — гладкий металл без нитей, как на референсе
    float ball = (1.0 - smoothstep(0.034, 0.042, min(dl, dr)));
    line = mix(line, 0.8, ball);
    diffuseColor.rgb = mix(FSP_DARK, diffuseColor.rgb, clamp(line, 0.0, 1.0));
  }
  #endif
`;
