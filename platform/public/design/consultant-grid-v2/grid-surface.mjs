import { createGridGPU } from './grid-webgl.mjs';
import { stabilizeHeightmap } from './grid-stability.mjs';
import { rasterizeHeightfield } from './grid-heightfield.mjs';

/* HeadGrid — голова карьерного консультанта, «выдавленная» из фоновой сетки.
 * V2: исходные модель и движения, WebGL2 вместо отрезков Canvas 2D.
 *
 *   const head = HeadGrid.create(canvas, data, { step: 46, relief: 1, angle: 0.5 });
 *   head.setStatus('speaking' | 'thinking' | 'idle');   // speaking — линии чуть темнеют, thinking — взгляд вверх
 *   head.setListening(true | false);                    // лёгкий наклон головы к собеседнику
 *   head.mouthFor('а');                                 // вызывать на каждый напечатанный/произнесённый символ
 *   head.setParams({ step: 32 });                       // шаг сетки в px, relief 0.3–1.6, angle 0–0.9 рад
 *   head.destroy();
 *
 * data — JSON { v:[x,y,z…], t:[i,j,k…], lip:[0|1|2…], mouthY } (consultant-head.json).
 * Размер берётся из canvas.parentElement; курсор отслеживается по window.pointermove.
 */

  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const VOWELS = 'аеёиоуыэюяaeiouy', LIPS = 'мбпвфmbpvf';

  function create(canvas, data, opts) {
    const prm = Object.assign({ step: 46, relief: 1, angle: 0.5 }, opts || {});
    const stage = canvas.parentElement;
    const { v, t, lip, mouthY } = data, nv = v.length / 3, nt = t.length / 3;
    const W = new Float32Array(nv), B = new Float32Array(nv * 3), HW = new Float32Array(nv);
    for (let i = 0; i < nv; i++) {
      const x = v[i * 3], y = v[i * 3 + 1], z = v[i * 3 + 2];
      let w;
      if (lip[i] === 1) w = 1; else if (lip[i] === 2) w = 0;
      else { const k = Math.max(0, Math.abs(x) - 0.05) * 1.4; w = 1 - ss(mouthY - 0.012 - k, mouthY + 0.012 + k, y); }
      W[i] = w * ss(-0.04, 0.2, z) * ss(0.2, 0.31, y) * (1 - ss(0.2, 0.3, Math.abs(x)));
      B[i * 3] = x; B[i * 3 + 1] = y - 0.55; B[i * 3 + 2] = z;
      HW[i] = ss(-0.49, -0.2, y - 0.55);
    }
    const P = new Float32Array(nv * 3);
    const RX0 = -0.5, RX1 = 0.5, RY0 = -0.62, RY1 = 0.55, RC = 0.005;
    const RW = Math.ceil((RX1 - RX0) / RC) + 1, RH = Math.ceil((RY1 - RY0) / RC) + 1;
    const Z = new Float32Array(RW * RH), Zb = new Float32Array(RW * RH);
    const stable = new Float32Array(RW * RH);
    let lastSurfaceTime = null;
    let settling = false;
    let w = 0, h = 0, dpr = 1, f = 1, dirty = true, raf = 0, prev = '';
    const D = 5;
    const Lk = { x: 0, y: 0, tx: 0, ty: 0, last: -1e9 }, M = { v: 0, t: 0 }, Hv = { x: -1e4, y: -1e4, a: 0, ta: 0 };
    const st = { status: 'idle', listening: false, talk: 0 };
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const gpu = createGridGPU(canvas, RW, RH, [RX0, RY0], RC);

    const fit = () => {
      w = stage.clientWidth; h = stage.clientHeight; if (!w || !h) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      f = (Math.min(h, w * 1.1) / 2) / 0.72 * D; dirty = true;
    };
    const ro = new ResizeObserver(fit); ro.observe(stage); fit();
    const onMove = e => {
      const r = stage.getBoundingClientRect();
      Lk.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width * 0.55)));
      Lk.ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.42)) / (r.height * 0.55)));
      Lk.last = performance.now();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      Hv.x = e.clientX - r.left; Hv.y = e.clientY - r.top; Hv.ta = inside ? 1 : 0;
    };
    window.addEventListener('pointermove', onMove);

    const draw = (jaw, yaw, pitch, talk, hov, pYaw, pPitch, now) => {
      const cj = Math.cos(jaw), sj = Math.sin(jaw), cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (let i = 0; i < nv; i++) {
        let x = B[i * 3], y = B[i * 3 + 1], z = B[i * 3 + 2];
        const jw = W[i];
        if (jw > 0) { const dy = y + 0.08, dz = z + 0.02; const ry = dy * cj - dz * sj, rz = dy * sj + dz * cj; y += (ry - dy) * jw; z += (rz - dz) * jw; }
        const hw = HW[i];
        if (hw > 0) {
          const dx = x, dy = y + 0.33, dz = z + 0.04;
          const py = dy * cp - dz * sp, pz = dy * sp + dz * cp;
          const qx = dx * cy + pz * sy, qz = -dx * sy + pz * cy;
          x += (qx - dx) * hw; y += (py - dy) * hw; z += (qz - dz) * hw;
        }
        P[i * 3] = (x - RX0) / RC; P[i * 3 + 1] = (y - RY0) / RC; P[i * 3 + 2] = z;
      }
      // карта высот: максимальная глубина лица над плоскостью сетки
      rasterizeHeightfield(P, t, RW, RH, Z);
      for (let y = 1; y < RH - 1; y++) for (let x = 1; x < RW - 1; x++) { const i = y * RW + x; Zb[i] = (Z[i] * 2 + Z[i - 1] + Z[i + 1] + Z[i - RW] + Z[i + RW]) / 6; }
      Z.set(Zb);
      stabilizeHeightmap(stable, Z, now - (lastSurfaceTime ?? now), lastSurfaceTime !== null);
      settling = Z.some((height, i) => Math.abs(height - stable[i]) > 0.00002);
      lastSurfaceTime = now;
      gpu.draw(stable, { w, h, dpr, focal: f, relief: prm.relief * 1.25, yaw: pYaw, pitch: pPitch,
        stepSize: prm.step / (f / D), talk, hover: hov, x: Hv.x, y: Hv.y });
    };

    const tick = now => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || !w) return;
      if (now - Lk.last > 3000 && !reduce) { Lk.tx = Math.sin(now * 0.00037) * 0.35; Lk.ty = Math.sin(now * 0.00029) * 0.12 + (st.status === 'thinking' ? -0.25 : 0); }
      const k = reduce ? 0.2 : 0.07;
      Lk.x += (Lk.tx - Lk.x) * k; Lk.y += (Lk.ty - Lk.y) * k;
      M.t *= 0.82; M.v += (M.t - M.v) * 0.38;
      st.talk += ((st.status === 'speaking' ? 1 : 0) - st.talk) * 0.06;
      Hv.a += (Hv.ta - Hv.a) * 0.08;
      const base = +prm.angle;
      const yaw = Lk.x * 0.5, pitch = Lk.y * 0.28 + (reduce ? 0 : Math.sin(now * 0.0016) * 0.012) + (st.listening ? 0.05 : 0), jaw = M.v * 0.2;
      const pYaw = base + Lk.x * 0.1, pPitch = -0.12 - Lk.y * 0.06;
      const key = [yaw, pitch, jaw, st.talk, Hv.a, Hv.x, Hv.y, pYaw, pPitch].map(q => q.toFixed(3)).join('|');
      if (key === prev && !dirty && !settling) return;
      prev = key; dirty = false;
      draw(jaw, yaw, pitch, st.talk, Hv.a, pYaw, pPitch, now);
    };
    raf = requestAnimationFrame(tick);

    return {
      faces: nt,
      setParams(p) { Object.assign(prm, p); dirty = true; },
      setStatus(s) { st.status = s; if (s !== 'speaking') M.t = 0; },
      setListening(b) { st.listening = !!b; },
      mouthFor(ch) {
        const c = (ch || '').toLowerCase();
        if (VOWELS.includes(c)) M.t = 0.55 + Math.random() * 0.45;
        else if (LIPS.includes(c)) M.t = 0;
        else if (/[a-zа-я0-9]/i.test(c)) M.t = Math.max(M.t, 0.15 + Math.random() * 0.2);
      },
      destroy() { gpu.destroy(); cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('pointermove', onMove); }
    };
  }
export { create };
globalThis.HeadGrid = { create };
