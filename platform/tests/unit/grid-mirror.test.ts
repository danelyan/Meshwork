import { readFileSync } from 'node:fs';
import vm from 'node:vm';

it('keeps mirrored gaze and hover under the visible cursor while preserving normal v2 input', () => {
  const source = readFileSync('public/design/consultant-grid-v2/grid-surface.mjs', 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace('export { create };', '');
  const run = (mirror: boolean) => {
    let pointer: (event: { clientX: number; clientY: number }) => void = () => {};
    let tick: (now: number) => void = () => {};
    let drawn = { x: 0, y: 0, yaw: 0, hover: 0 };
    const canvas = { parentElement: {
      clientWidth: 800, clientHeight: 600,
      getBoundingClientRect: () => ({ left: 480, right: 1280, top: 72, bottom: 672, width: 800, height: 600 }),
    } };
    const context = vm.createContext({
      window: { devicePixelRatio: 1, addEventListener: (_type: string, cb: typeof pointer) => { pointer = cb; }, removeEventListener: () => {} },
      document: { hidden: false }, matchMedia: () => ({ matches: true }), performance: { now: () => 0 },
      ResizeObserver: class { observe() {} disconnect() {} },
      requestAnimationFrame: (cb: typeof tick) => { tick = cb; return 1; }, cancelAnimationFrame: () => {},
      rasterizeHeightfield: () => {}, stabilizeHeightmap: () => {},
      createGridGPU: () => ({ draw: (_heights: Float32Array, p: typeof drawn) => { drawn = p; }, destroy: () => {} }),
      canvas, mirror,
    });
    vm.runInContext(`${source}; globalThis.head = HeadGrid.create(canvas,
      { v: [0, 0.5, 0.3], t: [], lip: [0], mouthY: 0.435 }, { angle: 0, mirror });`, context);
    pointer({ clientX: 620, clientY: 320 });
    for (let frame = 0; frame < 60; frame++) tick(frame * 16);
    vm.runInContext('head.destroy()', context);
    return drawn;
  };
  const normal = run(false), mirrored = run(true);
  // After scaleX(-1), the shader hover must land at the original screen point.
  expect(480 + normal.x).toBe(620);
  expect(480 + 800 - mirrored.x).toBe(620);
  expect(mirrored.y).toBe(normal.y);
  expect(mirrored.hover).toBeCloseTo(normal.hover);
  // A visual leftward look is positive before reflecting the canvas.
  expect(normal.yaw).toBeLessThan(0);
  expect(mirrored.yaw).toBeCloseTo(-normal.yaw);
});
