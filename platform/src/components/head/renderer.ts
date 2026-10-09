import { parseHeadGlb, softenForehead } from './model';
import { headPointer } from './pointer';
import { sheetMotion } from './motion';
import { fragmentShader, heightFragmentShader, sheetVertexShader, vertexShader } from './shaders';

export type HeadRenderer = { dispose(): void; setPaused?(paused: boolean): void };

function rgb(value: string): [number, number, number] {
  const match = value.trim().match(/^#([\da-f]{6})$/i);
  if (!match) throw new Error('Expected a six-digit color token');
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Project the face into a height field, then draw one continuous background sheet. */
export async function createHeadRenderer(
  canvas: HTMLCanvasElement, signal: AbortSignal, reducedMotion: boolean,
  onContextLost: () => void, anchor: HTMLElement = canvas,
): Promise<HeadRenderer> {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error('WebGL 2 unavailable');
  const buffers: WebGLBuffer[] = [], shaders: WebGLShader[] = [], programs: WebGLProgram[] = [];
  const textures: WebGLTexture[] = [], framebuffers: WebGLFramebuffer[] = [], depths: WebGLRenderbuffer[] = [], arrays: WebGLVertexArrayObject[] = [];
  let raf = 0, disposed = false;
  const release = () => {
    buffers.forEach(value => gl.deleteBuffer(value)); shaders.forEach(value => gl.deleteShader(value));
    programs.forEach(value => gl.deleteProgram(value)); textures.forEach(value => gl.deleteTexture(value));
    framebuffers.forEach(value => gl.deleteFramebuffer(value)); depths.forEach(value => gl.deleteRenderbuffer(value));
    arrays.forEach(value => gl.deleteVertexArray(value));
  };
  try {
    const response = await fetch('/models/head.glb', { signal });
    if (!response.ok) throw new Error('Head model unavailable');
    const model = parseHeadGlb(await response.arrayBuffer());
    signal.throwIfAborted();
    const positions = softenForehead(model);
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Shader unavailable');
      shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed');
      return shader;
    };
    const link = (vertex: string, fragment: string) => {
      const value = gl.createProgram();
      if (!value) throw new Error('Program unavailable');
      programs.push(value); gl.attachShader(value, compile(gl.VERTEX_SHADER, vertex));
      gl.attachShader(value, compile(gl.FRAGMENT_SHADER, fragment)); gl.linkProgram(value);
      if (!gl.getProgramParameter(value, gl.LINK_STATUS)) throw new Error('Shader link failed');
      return value;
    };
    const relief = link(vertexShader, heightFragmentShader), sheet = link(sheetVertexShader, fragmentShader);
    const mesh = gl.createVertexArray(), plane = gl.createVertexArray();
    if (mesh) arrays.push(mesh);
    if (plane) arrays.push(plane);
    if (!mesh || !plane) throw new Error('Vertex array unavailable');
    gl.bindVertexArray(mesh);
    const bind = (data: Float32Array | Uint32Array, target = gl.ARRAY_BUFFER as number) => {
      const value = gl.createBuffer();
      if (!value) throw new Error('Buffer unavailable');
      buffers.push(value); gl.bindBuffer(target, value); gl.bufferData(target, data, gl.STATIC_DRAW);
    };
    [positions, model.normals].forEach((data, index) => {
      bind(data); gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, 3, gl.FLOAT, false, 0, 0);
    });
    bind(model.indices, gl.ELEMENT_ARRAY_BUFFER);
    const texture = gl.createTexture(), framebuffer = gl.createFramebuffer(), depth = gl.createRenderbuffer();
    if (texture) textures.push(texture);
    if (framebuffer) framebuffers.push(framebuffer);
    if (depth) depths.push(depth);
    if (!texture || !framebuffer || !depth) throw new Error('Height field unavailable');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const location = (program: WebGLProgram, name: string) => gl.getUniformLocation(program, 'u' + name);
    const r = { angle: location(relief, 'Angle'), anchor: location(relief, 'Anchor'), stage: location(relief, 'Stage'), blink: location(relief, 'Blink'), breath: location(relief, 'Breath') };
    const s = { anchor: location(sheet, 'Anchor'), viewport: location(sheet, 'Viewport'), textureSize: location(sheet, 'TextureSize'), offset: location(sheet, 'PageOffset'), time: location(sheet, 'Time') };
    const css = getComputedStyle(canvas);
    gl.useProgram(sheet);
    gl.uniform3fv(location(sheet, 'Paper'), rgb(css.getPropertyValue('--paper')));
    gl.uniform3fv(location(sheet, 'Ink'), rgb(css.getPropertyValue('--ink')));
    gl.uniform1i(location(sheet, 'Height'), 0);
    let textureWidth = 0, textureHeight = 0;
    let targetX = -.10, targetY = .025, angleX = targetX, angleY = targetY;
    let lastDraw = 0, visible = true, paused = false, animationTime = 0, previousTime = 0;
    const schedule = () => { if (!disposed && !raf && !document.hidden) raf = requestAnimationFrame(frame); };
    const pointer = (event: PointerEvent) => {
      if (!visible || paused || reducedMotion || event.pointerType === 'touch') return;
      const [x, y] = headPointer(event.clientX, event.clientY, innerWidth, innerHeight);
      targetX = -.10 + x * .24; targetY = .025 - y * .12; schedule();
    };
    const leave = () => { if (visible && !paused && !reducedMotion) { targetX = -.10; targetY = .025; schedule(); } };
    function frame(now: number) {
      raf = 0;
      if (disposed || document.hidden) return;
      if (!reducedMotion && !paused && visible && now - lastDraw < 1000 / 24) { schedule(); return; }
      lastDraw = now;
      if (!paused && !reducedMotion && visible) {
        animationTime += previousTime ? Math.min(now - previousTime, 100) : 0;
        angleX += (targetX - angleX) * .12; angleY += (targetY - angleY) * .12;
      }
      previousTime = now;
      const motion = sheetMotion(animationTime, reducedMotion);
      const bounds = canvas.getBoundingClientRect(), face = anchor.getBoundingClientRect();
      const dpr = Math.min(devicePixelRatio, 1.5);
      const width = Math.max(1, Math.round(bounds.width * dpr)), height = Math.max(1, Math.round(bounds.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      // The height texture is capped independently of device pixels and chat length.
      const ratio = Math.min(1, 1024 / Math.max(bounds.width, bounds.height));
      const tw = Math.max(1, Math.round(bounds.width * ratio)), th = Math.max(1, Math.round(bounds.height * ratio));
      gl!.activeTexture(gl!.TEXTURE0); gl!.bindTexture(gl!.TEXTURE_2D, texture);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, framebuffer);
      gl!.disable(gl!.BLEND); gl!.disable(gl!.CULL_FACE);
      gl!.disable(gl!.DITHER);
      gl!.depthMask(true); gl!.clearDepth(1); gl!.colorMask(true, true, true, true);
      if (tw !== textureWidth || th !== textureHeight) {
        textureWidth = tw; textureHeight = th;
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, tw, th, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
        gl!.bindRenderbuffer(gl!.RENDERBUFFER, depth); gl!.renderbufferStorage(gl!.RENDERBUFFER, gl!.DEPTH_COMPONENT16, tw, th);
        if (gl!.checkFramebufferStatus(gl!.FRAMEBUFFER) !== gl!.FRAMEBUFFER_COMPLETE) { onContextLost(); return; }
      }
      gl!.viewport(0, 0, tw, th); gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
      const ax = face.left - bounds.left, ay = face.top - bounds.top;
      gl!.enable(gl!.DEPTH_TEST); gl!.depthFunc(gl!.LEQUAL); gl!.useProgram(relief); gl!.bindVertexArray(mesh);
      gl!.uniform2f(r.angle, angleX + motion.yaw, angleY + motion.pitch);
      gl!.uniform4f(r.anchor, ax, ay, face.width, face.height); gl!.uniform2f(r.stage, bounds.width, bounds.height);
      gl!.uniform1f(r.blink, motion.blink); gl!.uniform1f(r.breath, motion.breath);
      if (visible) gl!.drawElements(gl!.TRIANGLES, model.indices.length, gl!.UNSIGNED_INT, 0);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null); gl!.viewport(0, 0, width, height); gl!.disable(gl!.DEPTH_TEST);
      gl!.useProgram(sheet); gl!.bindVertexArray(plane);
      gl!.uniform4f(s.anchor, ax, ay, face.width, face.height); gl!.uniform4f(s.viewport, bounds.left, bounds.top, bounds.width, bounds.height);
      gl!.uniform2f(s.offset, 0, 0); gl!.uniform2f(s.textureSize, tw, th);
      gl!.uniform1f(s.time, animationTime / 1000);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      canvas.dataset.rendered = 'grid-relief';
      if (!reducedMotion && !paused && visible) schedule();
    }
    const lost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(raf); raf = 0; onContextLost(); };
    const observer = new IntersectionObserver(entries => {
      visible = entries[0]?.isIntersecting ?? false; previousTime = 0;
      cancelAnimationFrame(raf); raf = 0; schedule();
    });
    const resize = new ResizeObserver(schedule);
    observer.observe(anchor); resize.observe(canvas);
    if (anchor !== canvas) resize.observe(anchor);
    if (!reducedMotion) { document.addEventListener('pointermove', pointer, { passive: true }); document.addEventListener('pointerleave', leave); }
    const visibility = () => { cancelAnimationFrame(raf); raf = 0; previousTime = 0; schedule(); };
    const abort = () => dispose();
    document.addEventListener('visibilitychange', visibility); document.addEventListener('scroll', schedule, { passive: true });
    canvas.addEventListener('webglcontextlost', lost); signal.addEventListener('abort', abort, { once: true });
    function dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); resize.disconnect();
      document.removeEventListener('pointermove', pointer); document.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('scroll', schedule);
      canvas.removeEventListener('webglcontextlost', lost); signal.removeEventListener('abort', abort); release();
    }
    schedule();
    return { dispose, setPaused(value) { paused = value; previousTime = 0; cancelAnimationFrame(raf); raf = 0; schedule(); } };
  } catch (error) { release(); throw error; }
}
