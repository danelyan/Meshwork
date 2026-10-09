import { parseHeadGlb } from './model';
import { headPointer } from './pointer';
import { backdropFragmentShader, backdropVertexShader, fragmentShader, vertexShader } from './shaders';

export type HeadRenderer = { dispose(): void; setPaused?(paused: boolean): void };

function rgb(value: string): [number, number, number] {
  const match = value.trim().match(/^#([\da-f]{6})$/i);
  if (!match) throw new Error('Expected a six-digit color token');
  const n = parseInt(match[1]!, 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Glass material from codex/interactive-head over the original static page grid. */
export async function createHeadRenderer(canvas: HTMLCanvasElement, signal: AbortSignal, reducedMotion: boolean, onContextLost: () => void): Promise<HeadRenderer> {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
  if (!gl) throw new Error('WebGL 2 unavailable');
  const buffers: WebGLBuffer[] = [], textures: WebGLTexture[] = [], shaders: WebGLShader[] = [], bitmaps: ImageBitmap[] = [];
  let program: WebGLProgram | null = null, backdropProgram: WebGLProgram | null = null;
  let backdropFBO: WebGLFramebuffer | null = null, raf = 0, disposed = false;
  const release = () => {
    buffers.forEach(buffer => gl.deleteBuffer(buffer));
    textures.forEach(texture => gl.deleteTexture(texture));
    shaders.forEach(shader => gl.deleteShader(shader));
    if (program) gl.deleteProgram(program);
    if (backdropProgram) gl.deleteProgram(backdropProgram);
    if (backdropFBO) gl.deleteFramebuffer(backdropFBO);
    bitmaps.forEach(bitmap => bitmap.close());
  };
  try {
    const response = await fetch('/models/head.glb', { signal });
    if (!response.ok) throw new Error('Head model unavailable');
    const model = parseHeadGlb(await response.arrayBuffer());
    signal.throwIfAborted();
    for (const image of [model.images[0], model.images[2]]) {
      if (!image) throw new Error('Missing head texture');
      bitmaps.push(await createImageBitmap(image));
    }
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
    backdropProgram = gl.createProgram();
    if (!backdropProgram) throw new Error('Backdrop program unavailable');
    gl.attachShader(backdropProgram, compile(gl.VERTEX_SHADER, backdropVertexShader));
    gl.attachShader(backdropProgram, compile(gl.FRAGMENT_SHADER, backdropFragmentShader)); gl.linkProgram(backdropProgram);
    if (!gl.getProgramParameter(backdropProgram, gl.LINK_STATUS)) throw new Error('Backdrop link failed');
    gl.useProgram(program);
    const bind = (data: Float32Array | Uint32Array, target = gl.ARRAY_BUFFER as number) => {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error('Buffer unavailable');
      buffers.push(buffer); gl.bindBuffer(target, buffer); gl.bufferData(target, data, gl.STATIC_DRAW);
      return buffer;
    };
    [model.positions, model.normals, model.uv, model.positions, model.normals].forEach((data, index) => {
      bind(data); gl.enableVertexAttribArray(index); gl.vertexAttribPointer(index, index === 2 ? 2 : 3, gl.FLOAT, false, 0, 0);
    });
    const triangles = model.indices;
    const triangleBuffer = bind(triangles, gl.ELEMENT_ARRAY_BUFFER);
    bitmaps.forEach((bitmap, index) => {
      const texture = gl.createTexture();
      if (!texture) throw new Error('Texture unavailable');
      textures.push(texture); gl.activeTexture(gl.TEXTURE0 + index); gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.generateMipmap(gl.TEXTURE_2D);
    });
    const uniform = (name: string) => gl.getUniformLocation(program!, `u${name}`);
    const angleUniform = uniform('Angle'), pointerUniform = uniform('Pointer'), aspectUniform = uniform('Aspect');
    gl.uniform1i(uniform('Texture'), 0); gl.uniform1i(uniform('NormalMap'), 1);
    const css = getComputedStyle(canvas);
    gl.uniform3fv(uniform('Accent'), rgb(css.getPropertyValue('--blue')));
    gl.uniform3fv(uniform('Silver'), rgb(css.getPropertyValue('--paper')));
    const backdrop = gl.createTexture();
    if (!backdrop) throw new Error('Backdrop texture unavailable');
    textures.push(backdrop); gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, backdrop);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(uniform('Backdrop'), 2);
    backdropFBO = gl.createFramebuffer();
    if (!backdropFBO) throw new Error('Backdrop framebuffer unavailable');
    const bgUniform = (name: string) => gl.getUniformLocation(backdropProgram!, `u${name}`);
    const paper = rgb(css.getPropertyValue('--paper')), ink = rgb(css.getPropertyValue('--ink'));
    let textureWidth = 0, textureHeight = 0;
    gl.uniform1f(uniform('Strength'), 1); gl.uniform1f(uniform('Smooth'), 0);
    gl.uniform1f(uniform('Zoom'), 1); gl.uniform1f(uniform('Time'), 0); gl.uniform1f(uniform('Burst'), 0);
    gl.uniform1i(uniform('Mode'), 5); gl.uniform1i(uniform('Wire'), 0);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
    let targetX = -.15, targetY = .03, angleX = targetX, angleY = targetY;
    let pointerX = 0, pointerY = 0, lastDraw = 0, visible = true, paused = false;
    const pointer = (event: PointerEvent) => {
      if (paused || event.pointerType === 'touch') return;
      [pointerX, pointerY] = headPointer(event.clientX, event.clientY, innerWidth, innerHeight);
      targetX = -.15 + pointerX * .7; targetY = .03 - pointerY * .15;
      schedule();
    };
    const leave = () => { if (paused) return; pointerX = 0; pointerY = 0; targetX = -.15; targetY = .03; schedule(); };
    const schedule = () => { if (!disposed && !raf) raf = requestAnimationFrame(frame); };
    function frame(now: number) {
      raf = 0;
      if (disposed || !visible || document.hidden) return;
      if (!reducedMotion && now - lastDraw < 1000 / 30) { schedule(); return; }
      lastDraw = now;
      if (!paused) { angleX += (targetX - angleX) * .16; angleY += (targetY - angleY) * .16; }
      const bounds = canvas.getBoundingClientRect(), dpr = Math.min(devicePixelRatio, 1.5);
      const width = Math.max(1, Math.round(bounds.width * dpr)), height = Math.max(1, Math.round(bounds.height * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl!.viewport(0, 0, width, height); gl!.clearColor(0, 0, 0, 0); gl!.clear(gl!.COLOR_BUFFER_BIT | gl!.DEPTH_BUFFER_BIT);
      gl!.activeTexture(gl!.TEXTURE2); gl!.bindTexture(gl!.TEXTURE_2D, backdrop);
      if (textureWidth !== width || textureHeight !== height) {
        gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, width, height, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
        textureWidth = width; textureHeight = height;
      }
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, backdropFBO);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, backdrop, 0);
      gl!.useProgram(backdropProgram); gl!.disable(gl!.DEPTH_TEST);
      gl!.uniform3fv(bgUniform('Background'), paper); gl!.uniform3fv(bgUniform('Ink'), ink);
      gl!.uniform2f(bgUniform('Resolution'), width, height); gl!.uniform2f(bgUniform('Origin'), bounds.left, bounds.top + scrollY);
      gl!.uniform1f(bgUniform('Dpr'), dpr);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null); gl!.useProgram(program); gl!.enable(gl!.DEPTH_TEST);
      gl!.uniform2f(uniform('Resolution'), width, height);
      gl!.uniform2f(angleUniform, angleX, angleY); gl!.uniform2f(pointerUniform, pointerX, pointerY); gl!.uniform1f(aspectUniform, width / height);
      gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, triangleBuffer); gl!.uniform1i(uniform('Wire'), 0);
      gl!.enable(gl!.BLEND); gl!.blendFuncSeparate(gl!.SRC_ALPHA, gl!.ONE_MINUS_SRC_ALPHA, gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);
      gl!.enable(gl!.CULL_FACE); gl!.cullFace(gl!.FRONT); gl!.depthMask(false); gl!.uniform1f(uniform('Backface'), 1);
      gl!.drawElements(gl!.TRIANGLES, triangles.length, gl!.UNSIGNED_INT, 0);
      gl!.cullFace(gl!.BACK); gl!.depthMask(true); gl!.uniform1f(uniform('Backface'), 0);
      gl!.drawElements(gl!.TRIANGLES, triangles.length, gl!.UNSIGNED_INT, 0);
      gl!.disable(gl!.CULL_FACE); gl!.disable(gl!.BLEND);
      canvas.dataset.rendered = 'glass';
      if (!paused && !reducedMotion && (Math.abs(targetX - angleX) > .0001 || Math.abs(targetY - angleY) > .0001)) schedule();
    }
    const lost = (event: Event) => { event.preventDefault(); cancelAnimationFrame(raf); raf = 0; onContextLost(); };
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting ?? false; if (visible) schedule(); });
    const resize = new ResizeObserver(schedule);
    observer.observe(canvas); resize.observe(canvas);
    if (!reducedMotion) { document.addEventListener('pointermove', pointer, { passive: true }); document.addEventListener('pointerleave', leave); }
    document.addEventListener('visibilitychange', schedule); canvas.addEventListener('webglcontextlost', lost);
    schedule();
    return { setPaused(value) { paused = value; if (!value) schedule(); }, dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(raf); observer.disconnect(); resize.disconnect();
      document.removeEventListener('pointermove', pointer); document.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', schedule); canvas.removeEventListener('webglcontextlost', lost); release();
    } };
  } catch (error) { release(); throw error; }
}
