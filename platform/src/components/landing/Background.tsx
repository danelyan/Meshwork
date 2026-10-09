'use client';

import { useEffect, useRef } from 'react';

import styles from './Background.module.css';

interface Pt { ox: number; oy: number; x: number; y: number; g: number }

const S = 46; // шаг сетки
const R = 230; // радиус влияния курсора
const L = 6; // ступеней яркости линий

/** Читает токен-цвет вида #rrggbb в «r,g,b» для rgba() на canvas. */
function rgbOf(token: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim() || fallback;
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) return '17,17,17';
  const n = parseInt(m[1]!, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** Фон-сетка: узлы расходятся от курсора и плывущих карточек компаний. Декор; на мобильном и при reduced-motion — статика/выключено. */
export function Background() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ink = rgbOf('--ink', '#111111');
    const blue = rgbOf('--blue', '#402fff');
    let W = 0;
    let H = 0;
    let cols = 0;
    let rows = 0;
    let P: Pt[] = [];
    const m = { x: -1e4, y: -1e4, sx: -1e4, sy: -1e4 };
    let raf = 0;

    const resize = () => {
      const dpr = Math.min(2, devicePixelRatio || 1);
      W = innerWidth;
      H = innerHeight;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(W / S) + 2;
      rows = Math.ceil(H / S) + 2;
      P = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const ox = (i - 0.5) * S;
          const oy = (j - 0.5) * S;
          P.push({ ox, oy, x: ox, y: oy, g: 0 });
        }
      }
      if (reduce) frame(0);
    };
    const onMove = (e: PointerEvent) => {
      m.x = e.clientX;
      m.y = e.clientY;
      if (m.sx < -1e3) {
        m.sx = m.x;
        m.sy = m.y;
      }
    };
    const onLeave = () => {
      m.x = m.y = -1e4;
    };

    function frame(t: number) {
      if (!reduce) {
        m.sx += (m.x - m.sx) * 0.12;
        m.sy += (m.y - m.sy) * 0.12;
        if (m.x < -1e3) m.sx = m.sy = -1e4;
        if (innerWidth <= 640) {
          raf = requestAnimationFrame(frame);
          return;
        }
      }
      const D: Array<{ x: number; y: number; R: number; k: number; s: number }> = [{ x: m.sx, y: m.sy, R, k: 30, s: 1 }];
      if (!reduce) {
        document.querySelectorAll('[data-tile]').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > 0 && r.left < W && r.bottom > 0 && r.top < H) D.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, R: r.width * 0.8, k: 9, s: 0.38 });
        });
      }
      for (const p of P) {
        let ox = 0;
        let oy = 0;
        let g = 0;
        for (const q of D) {
          const dx = p.ox - q.x;
          const dy = p.oy - q.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d < q.R) {
            const f = 1 - d / q.R;
            ox += (dx / d) * f * f * q.k;
            oy += (dy / d) * f * f * q.k;
            g = Math.max(g, f * q.s);
          }
        }
        const wx = reduce ? 0 : Math.sin(t * 0.0006 + p.oy * 0.018) * 2.2;
        const wy = reduce ? 0 : Math.cos(t * 0.0005 + p.ox * 0.018) * 2.2;
        p.x += (p.ox + ox + wx - p.x) * 0.18;
        p.y += (p.oy + oy + wy - p.y) * 0.18;
        p.g = g;
      }
      ctx!.clearRect(0, 0, W, H);
      const B: Pt[][] = Array.from({ length: L }, () => []);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const p = P[j * cols + i]!;
          const r = i < cols - 1 ? P[j * cols + i + 1]! : null;
          const b = j < rows - 1 ? P[(j + 1) * cols + i]! : null;
          for (const q of [r, b]) if (q) B[Math.min(L - 1, Math.floor(((p.g + q.g) / 2) * L))]!.push(p, q);
        }
      }
      B.forEach((a, lv) => {
        if (!a.length) return;
        ctx!.beginPath();
        for (let n = 0; n < a.length; n += 2) {
          ctx!.moveTo(a[n]!.x, a[n]!.y);
          ctx!.lineTo(a[n + 1]!.x, a[n + 1]!.y);
        }
        ctx!.strokeStyle = `rgba(${ink},${(0.045 + (lv / L) * 0.2).toFixed(3)})`;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      });
      for (const p of P) {
        const s = p.g > 0.55 ? 3 : 2;
        ctx!.fillStyle = p.g > 0.55 ? `rgba(${blue},${(0.35 + p.g * 0.5).toFixed(2)})` : `rgba(${ink},${(0.14 + p.g * 0.35).toFixed(2)})`;
        ctx!.fillRect(p.x - s / 2, p.y - s / 2, s, s);
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    }

    resize();
    addEventListener('resize', resize);
    if (!reduce) {
      addEventListener('pointermove', onMove);
      document.addEventListener('pointerleave', onLeave);
      raf = requestAnimationFrame(frame);
    }
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, []);

  return <canvas ref={ref} className={styles.bg} aria-hidden="true" />;
}
