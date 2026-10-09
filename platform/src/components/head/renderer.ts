import { parseHeadGlb } from './model';
import { headPointer } from './pointer';
import { fragmentShader, vertexShader } from './shaders';

export type HeadRenderer = { dispose(): void };

function rgb(value: string): [number, number, number] {
  const match = value.trim().match(/^#([\da-f]{6})$/i);
  if (!match) throw new Error('Expected a six-digit color token');
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A soft face relief pressing through the page grid on a transparent stage. */
export async function createHeadRenderer(canvas: HTMLCanvasElement, signal: AbortSignal, reducedMotion: boolean, onContextLost: () => void): Promise<HeadRenderer> {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error('WebGL 2 unavailable');
  const buffers: WebGLBuffer[] = [], shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null, raf = 0, disposed = false;
  const release = () => {
    buffers.forEach(buffer => gl.deleteBuffer(buffer));
    shaders.forEach(shader => gl.deleteShader(shader));
    if (program) gl.deleteProgram(program);
  };
  try {
    const response = await fetch('/models/head.glb', { signal });
    if (!response.ok) throw new Error('Head model unavailable');
    const model = parseHeadGlb(await response.arrayBuffer());
    signal.throwIfAborted();
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader unavailable');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed');
      return shader;
    };
    program = gl.createProgram();
    if (!program) throw new Error('Program unavailable');
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentShader)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
    gl.useProgram(program);
    const bind = (data: Float32Array | Uint32Array, target = gl.ARRAY_BUFFER as number) => {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Buffer unavailable');
      buffers.push(buffer); gl.bindBuffer(target, buffer); gl.bufferData(target, data, gl.STATIC_DRAW);
    };
    [model.positions, model.normals].forEach((data, index) => {
      bind(data); gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, 3, gl.FLOAT, false, 0, 0);
    });
    bind(model.indices, gl.ELEMENT_ARRAY_BUFFER);
    const uniform = (name: string) => gl.getUniformLocation(program!, `u${name}`);
    const angleUniform = uniform('Angle'), aspectUniform = uniform('Aspect');
    const viewportUniform = uniform('Viewport'), dprUniform = uniform('Dpr');
    const css = getComputedStyle(canvas);
    gl.uniform3fv(uniform('Paper'), rgb(css.getPropertyValue('--paper')));
    gl.uniform3fv(uniform('Ink'), rgb(css.getPropertyValue('--ink')));
    gl.uniform3fv(uniform('Muted'), rgb(css.getPropertyValue('--muted')));
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    let targetX = -.15, targetY = .03, angleX = targetX, angleY = targetY;
    let lastDraw = 0, visible = true;
    const pointer = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const [pointerX, pointerY] = headPointer(event.clientX, event.clientY, innerWidth, innerHeight);
      targetX = -.15 + pointerX * .32; targetY = .03 - pointerY * .15;
      schedule();
    };
    const leave = () => { targetX = -.15; targetY = .03; schedule(); };
    const schedule = () => { if (!disposed && !raf) raf = requestAnimationFrame(frame); };
    function frame(now: number) {
      raf = 0;
      if (disposed || !visible || document.hidden) return;
      if (!reducedMotion && now - lastDraw < 1000 / 30) { schedule(); return; }
      lastDraw = now;
      angleX += (targetX - angleX) * .16; angleY += (targetY - angleY) * .16;
      const bounds = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 1.5);
      const width = Math.max(1, Math.round(bounds.width * dpr)), height = Math.max(1, Math.round(bounds.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl!.viewport(0, 0, width, height); gl!.clearColor(0, 0, 0, 0); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
      gl!.uniform2f(angleUniform, angleX, angleY); gl!.uniform1f(aspectUniform, width / height);
      gl!.uniform4f(viewportUniform, bounds.left, bounds.top, bounds.width, bounds.height);
      gl!.uniform1f(dprUniform, dpr);
      gl!.drawElements(gl!.TRIANGLES, model.indices.length, gl!.UNSIGNED_INT, 0);
      canvas.dataset.rendered = 'grid-relief';
      if (!reducedMotion && (Math.abs(targetX - angleX) > .0001 || Math.abs(targetY - angleY) > .0001)) schedule();
    }
    const lost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(raf); raf = 0; onContextLost(); };
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible) schedule(); });
    const resize = new ResizeObserver(schedule);
    observer.observe(canvas); resize.observe(canvas);
    if (!reducedMotion) { document.addEventListener('pointermove', pointer, { passive: true }); document.addEventListener('pointerleave', leave); }
    document.addEventListener('visibilitychange', schedule); document.addEventListener('scroll', schedule, { passive: true }); canvas.addEventListener('webglcontextlost', lost);
    schedule();
    return { dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); resize.disconnect();
      document.removeEventListener('pointermove', pointer); document.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', schedule); document.removeEventListener('scroll', schedule); canvas.removeEventListener('webglcontextlost', lost); release();
    } };
  } catch (error) { release(); throw error; }
}
